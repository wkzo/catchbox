import { readFile } from 'node:fs/promises';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { AppConfig } from '@catchbox/config';
import type { Db } from '@catchbox/db';
import type { ObjectStore } from '@catchbox/store';
import type { RealtimeEvent } from '@catchbox/types';
import { aliases, outboundJobs, deliveryAttempts, drafts, messages, threads } from '@catchbox/db';
import { signMessage } from '../lib/dkim.js';
import { normalizeSubject } from '../lib/mime.js';
import { dispatch } from './transports.js';

let cachedDkimKey: string | null | undefined;

async function loadDkimKey(cfg: AppConfig): Promise<string | null> {
  if (cachedDkimKey !== undefined) return cachedDkimKey;
  if (!cfg.DKIM_PRIVATE_KEY_PATH) {
    cachedDkimKey = null;
    return null;
  }
  try {
    cachedDkimKey = await readFile(cfg.DKIM_PRIVATE_KEY_PATH, 'utf8');
  } catch {
    cachedDkimKey = null;
  }
  return cachedDkimKey;
}

interface Deps {
  cfg: AppConfig;
  db: Db;
  store: ObjectStore;
  publish: (userId: string, event: RealtimeEvent) => Promise<void>;
}

export async function processSendJob(deps: Deps, jobId: string): Promise<void> {
  const { cfg, db, store, publish } = deps;
  const [job] = await db.select().from(outboundJobs).where(eq(outboundJobs.id, jobId)).limit(1);
  if (!job || job.status === 'sent') return;

  const alias = job.aliasId
    ? (await db.select().from(aliases).where(eq(aliases.id, job.aliasId)).limit(1))[0]
    : undefined;
  if (!alias) {
    await db.update(outboundJobs).set({ status: 'failed', lastError: 'Alias missing' }).where(eq(outboundJobs.id, jobId));
    await publish(job.userId, { type: 'outbound:status', jobId, status: 'failed', error: 'Alias missing' });
    return;
  }

  const fromAddress = `${alias.localpart}@${cfg.DOMAIN}`;
  const recipients = [...job.to, ...job.cc, ...job.bcc];
  if (!recipients.every((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))) {
    await db.update(outboundJobs).set({ status: 'failed', lastError: 'Invalid recipient' }).where(eq(outboundJobs.id, jobId));
    await publish(job.userId, { type: 'outbound:status', jobId, status: 'failed', error: 'Invalid recipient' });
    return;
  }

  const attBodies: { filename: string; contentType: string; content: Buffer }[] = [];
  if (job.draftId) {
    const [d] = await db.select().from(drafts).where(eq(drafts.id, job.draftId)).limit(1);
    if (d) {
      for (const a of d.attachments) {
        const buf = await store.get(a.storageKey);
        if (buf) attBodies.push({ filename: a.filename, contentType: a.contentType, content: buf });
      }
    }
  }

  const composer = new MailComposer({
    from: alias.displayName ? `${alias.displayName} <${fromAddress}>` : fromAddress,
    to: job.to.join(','),
    cc: job.cc.join(',') || undefined,
    bcc: job.bcc.join(',') || undefined,
    subject: job.subject || '(no subject)',
    text: job.textBody ?? '',
    html: job.htmlBody ?? undefined,
    messageId: job.messageIdHeader ?? undefined,
    inReplyTo: job.inReplyTo ?? undefined,
    date: new Date(),
    attachments: attBodies.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content,
    })),
  });
  const raw = await composer.compile().build();
  const rawStr = raw.toString("binary");

  const dkimKey = await loadDkimKey(cfg);
  let signedRaw: string | null = null;
  if (dkimKey) {
    signedRaw = signMessage(rawStr, { domain: cfg.DOMAIN, selector: cfg.DKIM_SELECTOR, privateKeyPem: dkimKey });
  }
  // for non-self-hosted transports keep structured path; raw is still stored for audit
  await store.put(`outbound/${jobId.slice(0, 2)}/${jobId}.eml`, Buffer.from(signedRaw ?? rawStr, 'binary'), 'message/rfc822');

  await db.update(outboundJobs).set({ status: 'sending', updatedAt: new Date() }).where(eq(outboundJobs.id, jobId));
  const result = await dispatch(cfg, {
    fromAddress,
    fromName: alias.displayName,
    to: job.to,
    cc: job.cc,
    bcc: job.bcc,
    subject: job.subject,
    textBody: job.textBody ?? '',
    htmlBody: job.htmlBody,
    messageIdHeader: job.messageIdHeader ?? `<${jobId}@${cfg.DOMAIN}>`,
    inReplyTo: job.inReplyTo,
    signedRaw: signedRaw ? Buffer.from(signedRaw, 'binary').toString('utf8') : null,
    attachments: attBodies,
  });

  await db.insert(deliveryAttempts).values({
    id: nanoid(16),
    jobId,
    transport: cfg.MAIL_TRANSPORT,
    status: result.ok ? 'sent' : 'failed',
    response: result.response.slice(0, 1000),
  });

  if (!result.ok) {
    const attempts = job.attempts + 1;
    if (result.permanentFailure || attempts >= 5) {
      await db
        .update(outboundJobs)
        .set({ status: 'failed', attempts, lastError: result.response, updatedAt: new Date() })
        .where(eq(outboundJobs.id, jobId));
      await publish(job.userId, { type: 'outbound:status', jobId, status: 'failed', error: result.response });
      return;
    }
    await db.update(outboundJobs).set({ status: 'queued', attempts, lastError: result.response, updatedAt: new Date() }).where(eq(outboundJobs.id, jobId));
    throw new Error(result.response); // BullMQ retry with backoff
  }

  // sent copy in the Sent folder
  const sentMsgId = nanoid(16);
  let threadId = job.draftId
    ? (await db.select({ threadId: drafts.threadId }).from(drafts).where(eq(drafts.id, job.draftId!)).limit(1))[0]?.threadId ?? null
    : null;
  if (!threadId) {
    const norm = normalizeSubject(job.subject);
    const found = norm
      ? await db.select({ id: threads.id }).from(threads).where(eq(threads.subject, norm)).limit(1)
      : [];
    if (found[0]) threadId = found[0].id;
    else {
      const [t] = await db.insert(threads).values({ id: nanoid(16), userId: job.userId, subject: norm }).returning();
      threadId = t!.id;
    }
  }
  await db.insert(messages).values({
    id: sentMsgId,
    userId: job.userId,
    threadId,
    aliasId: alias.id,
    folder: 'sent',
    fingerprint: `outbound:${jobId}`,
    messageIdHeader: job.messageIdHeader,
    inReplyTo: job.inReplyTo,
    fromAddress,
    fromName: alias.displayName,
    to: job.to.map((a) => ({ address: a })),
    cc: job.cc.map((a) => ({ address: a })),
    bcc: job.bcc.map((a) => ({ address: a })),
    subject: job.subject,
    receivedAt: new Date(),
    textBody: job.textBody,
    htmlBody: job.htmlBody,
    rawKey: `outbound/${jobId.slice(0, 2)}/${jobId}.eml`,
    size: raw.length,
    read: true,
    dkimResult: dkimKey ? 'signed' : null,
  });
  await db
    .update(outboundJobs)
    .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date(), lastError: null })
    .where(eq(outboundJobs.id, jobId));
  if (job.draftId) {
    await db.delete(drafts).where(eq(drafts.id, job.draftId));
  }
  await publish(job.userId, { type: 'outbound:status', jobId, status: 'sent' });
}

export function startOutboundWorker(deps: Deps): Worker {
  const worker = new Worker(
    'outbound',
    async (job) => {
      await processSendJob(deps, job.data['jobId'] as string);
    },
    {
      connection: { url: deps.cfg.REDIS_URL },
      concurrency: 2,
    },
  );
  return worker;
}
