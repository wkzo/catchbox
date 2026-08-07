import { eq, and, sql, desc, gte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { draftSchema, sendSchema } from '@catchbox/types';
import { drafts, aliases, outboundJobs, messages, attachments } from '@catchbox/db';
import type { App } from '../lib/context.js';
import { httpError, requireCsrf, requireUser } from '../lib/auth.js';
import { publish } from '../lib/realtime.js';

const SAFE_NAME = /[^\w.\- ]+/g;

export async function composeRoutes(app: App) {
  app.get('/api/drafts', { onRequest: requireUser }, async (req) => {
    const rows = await app.ctx.db
      .select()
      .from(drafts)
      .where(eq(drafts.userId, req.user!.id))
      .orderBy(desc(drafts.updatedAt));
    return {
      drafts: rows.map((d) => ({
        id: d.id,
        aliasId: d.aliasId,
        to: d.to,
        cc: d.cc,
        bcc: d.bcc,
        subject: d.subject,
        textBody: d.textBody,
        htmlBody: d.htmlBody,
        threadId: d.threadId,
        inReplyTo: d.inReplyTo,
        attachments: d.attachments.map((a) => ({ id: a.id, filename: a.filename, size: a.size })),
        updatedAt: d.updatedAt.toISOString(),
      })),
    };
  });

  app.post('/api/drafts', { onRequest: [requireUser, requireCsrf] }, async (req, reply) => {
    const input = draftSchema.parse(req.body);
    if (input.aliasId) {
      const [a] = await app.ctx.db
        .select()
        .from(aliases)
        .where(and(eq(aliases.id, input.aliasId), eq(aliases.userId, req.user!.id)))
        .limit(1);
      if (!a) throw httpError(400, 'Unknown alias');
    }
    if (input.id) {
      const [existing] = await app.ctx.db
        .select()
        .from(drafts)
        .where(and(eq(drafts.id, input.id), eq(drafts.userId, req.user!.id)))
        .limit(1);
      if (!existing) throw httpError(404, 'Draft not found');
      await app.ctx.db
        .update(drafts)
        .set({
          aliasId: input.aliasId ?? null,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          subject: input.subject,
          textBody: input.textBody,
          htmlBody: input.htmlBody ?? null,
          updatedAt: new Date(),
        })
        .where(eq(drafts.id, input.id));
      return { id: input.id };
    }
    const id = nanoid(16);
    await app.ctx.db.insert(drafts).values({
      id,
      userId: req.user!.id,
      aliasId: input.aliasId ?? null,
      threadId: input.threadId ?? null,
      inReplyTo: input.inReplyTo ?? null,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody ?? null,
    });
    return reply.code(201).send({ id });
  });

  app.delete('/api/drafts/:id', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    await app.ctx.db.delete(drafts).where(and(eq(drafts.id, id), eq(drafts.userId, req.user!.id)));
    return { ok: true };
  });

  app.post('/api/drafts/:id/attachments', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    const [draft] = await app.ctx.db
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, id), eq(drafts.userId, req.user!.id)))
      .limit(1);
    if (!draft) throw httpError(404, 'Draft not found');
    const file = await req.file({ limits: { fileSize: app.ctx.cfg.MAX_ATTACHMENT_BYTES, files: 1 } });
    if (!file) throw httpError(400, 'No file uploaded');
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) chunks.push(chunk as Buffer);
    if ((file.file as { truncated?: boolean }).truncated) throw httpError(413, 'File too large');
    const body = Buffer.concat(chunks);
    const attId = nanoid(16);
    const key = `drafts/${id}/${attId}`;
    await app.ctx.store.put(key, body, file.mimetype);
    const filename = (file.filename ?? 'attachment').replace(SAFE_NAME, '_').slice(0, 200);
    const entry = { id: attId, filename, contentType: file.mimetype, size: body.length, storageKey: key };
    await app.ctx.db
      .update(drafts)
      .set({ attachments: [...draft.attachments, entry], updatedAt: new Date() })
      .where(eq(drafts.id, id));
    return { id: attId, filename, size: body.length };
  });

  app.delete('/api/drafts/:id/attachments/:attId', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id, attId } = req.params as { id: string; attId: string };
    const [draft] = await app.ctx.db
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, id), eq(drafts.userId, req.user!.id)))
      .limit(1);
    if (!draft) throw httpError(404, 'Draft not found');
    const removed = draft.attachments.find((a) => a.id === attId);
    if (removed) await app.ctx.store.delete(removed.storageKey);
    await app.ctx.db
      .update(drafts)
      .set({ attachments: draft.attachments.filter((a) => a.id !== attId) })
      .where(eq(drafts.id, id));
    return { ok: true };
  });

  app.post('/api/send', { onRequest: [requireUser, requireCsrf] }, async (req, reply) => {
    const input = sendSchema.parse(req.body);
    const recipients = [...input.to, ...input.cc, ...input.bcc];
    if (recipients.length === 0) throw httpError(400, 'At least one recipient required');
    if (recipients.length > 50) throw httpError(400, 'Too many recipients (max 50)');

    const aliasId = input.aliasId ?? null;
    if (!aliasId) throw httpError(400, 'From alias required');
    const [alias] = await app.ctx.db
      .select()
      .from(aliases)
      .where(and(eq(aliases.id, aliasId), eq(aliases.userId, req.user!.id)))
      .limit(1);
    if (!alias) throw httpError(400, 'Unknown alias');
    if (!alias.outboundEnabled) throw httpError(400, 'Outbound sending is disabled for this alias');

    const dayAgo = new Date(Date.now() - 86_400_000);
    const limitRows = await app.ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(outboundJobs)
      .where(and(eq(outboundJobs.userId, req.user!.id), gte(outboundJobs.createdAt, dayAgo)));
    if ((limitRows[0]?.n ?? 0) >= app.ctx.cfg.MAX_OUTBOUND_PER_DAY) throw httpError(429, 'Daily sending limit reached');

    let draftAttachments: typeof drafts.$inferSelect.attachments = [];
    if (input.draftId) {
      const [d] = await app.ctx.db
        .select()
        .from(drafts)
        .where(and(eq(drafts.id, input.draftId), eq(drafts.userId, req.user!.id)))
        .limit(1);
      if (d) draftAttachments = d.attachments;
    }

    const jobId = nanoid(16);
    const messageIdHeader = `<${nanoid(24)}.${Date.now()}@${app.ctx.cfg.DOMAIN}>`;
    await app.ctx.db.insert(outboundJobs).values({
      id: jobId,
      userId: req.user!.id,
      aliasId,
      draftId: input.draftId ?? null,
      status: 'queued',
      transport: app.ctx.cfg.MAIL_TRANSPORT,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody ?? null,
      messageIdHeader,
      inReplyTo: input.inReplyTo ?? null,
    });
    await app.ctx.outboundQueue.add('send', { jobId }, { jobId, attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 100, removeOnFail: 200 });
    await publish(app, req.user!.id, { type: 'outbound:status', jobId, status: 'queued' });
    return reply.code(202).send({ jobId, messageIdHeader, attachments: draftAttachments.length });
  });

  app.get('/api/messages/:id/raw', { onRequest: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [m] = await app.ctx.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, id), eq(messages.userId, req.user!.id)))
      .limit(1);
    if (!m?.rawKey) throw httpError(404, 'Raw message not found');
    const raw = await app.ctx.store.get(m.rawKey);
    if (!raw) throw httpError(404, 'Raw message not found');
    return reply
      .header('content-type', 'message/rfc822')
      .header('content-disposition', `attachment; filename="${m.id}.eml"`)
      .send(raw);
  });

  app.get('/api/attachments/:id', { onRequest: requireUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { inline?: string };
    const rows = await app.ctx.db
      .select({ attachment: attachments, messageUserId: messages.userId })
      .from(attachments)
      .innerJoin(messages, eq(attachments.messageId, messages.id))
      .where(eq(attachments.id, id))
      .limit(1);
    const row = rows[0];
    if (!row || row.messageUserId !== req.user!.id) throw httpError(404, 'Attachment not found');
    const att = row.attachment;
    if (att.virusStatus === 'infected') throw httpError(451, 'Attachment blocked: virus detected');
    if (att.virusStatus === 'pending') throw httpError(409, 'Attachment scan pending');
    const body = await app.ctx.store.get(att.storageKey);
    if (!body) throw httpError(404, 'Attachment data missing');
    const safeName = att.filename.replace(/["\\\r\n]/g, '_').slice(0, 200);
    const inlineOk = q.inline === '1' && /^(image\/|application\/pdf|text\/plain)/.test(att.contentType);
    const disposition = inlineOk ? 'inline' : 'attachment';
    return reply
      .header('content-type', att.contentType)
      .header('content-disposition', `${disposition}; filename="${encodeURIComponent(safeName)}"`)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'")
      .send(body);
  });
}
