import { createHash } from 'node:crypto';
import { and, asc, desc, eq, sql, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { AppConfig } from '@catchbox/config';
import type { Db } from '@catchbox/db';
import type { ObjectStore } from '@catchbox/store';
import {
  aliases,
  users,
  messages,
  messageRecipients,
  attachments,
  threads,
  rules,
  ruleHits,
  blockedSenders,
  labels,
  messageLabels,
} from '@catchbox/db';
import type { RealtimeEvent, MessageSummaryDto } from '@catchbox/types';
import { parseMime, normalizeSubject } from './lib/mime.js';
import { checkRspamd } from './lib/spam.js';
import { scanBuffer } from './lib/virus.js';

export interface IngestEnvelope {
  from: string;
  to: string[];
  clientIp?: string;
}

export type IngestOutcome =
  | { status: 'accepted'; messageId: string; duplicate?: boolean }
  | { status: 'rejected'; reason: string; permanent: boolean };

interface Deps {
  cfg: AppConfig;
  db: Db;
  store: ObjectStore;
  publish?: (userId: string, event: RealtimeEvent) => Promise<void>;
}

const SAFE_NAME = /[^\w.\- ]+/g;

function localpartOf(address: string, domain: string): string | null {
  const at = address.lastIndexOf('@');
  if (at === -1) return null;
  if (address.slice(at + 1).toLowerCase() !== domain) return null;
  return address.slice(0, at).toLowerCase();
}

function stripPlus(lp: string): string {
  const i = lp.indexOf('+');
  return i === -1 ? lp : lp.slice(0, i);
}

function wildcardMatch(pattern: string, localpart: string): boolean {
  const re = new RegExp(
    '^' + pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
    'i',
  );
  return re.test(localpart);
}

function fingerprint(messageId: string | null, env: IngestEnvelope, raw: Buffer): string {
  const h = createHash('sha256');
  h.update(messageId ?? '');
  h.update('|');
  h.update(env.from);
  h.update('|');
  h.update(env.to.join(','));
  h.update('|');
  h.update(createHash('sha256').update(raw).digest('hex').slice(0, 16));
  return h.digest('hex');
}

interface ConditionEval {
  field: string;
  op: string;
  value: string;
}

function matchesCondition(c: ConditionEval, ctx: Record<string, string>): boolean {
  const haystack = (ctx[c.field] ?? '').toLowerCase();
  const needle = c.value.toLowerCase();
  switch (c.op) {
    case 'contains':
      return haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'endsWith':
      return haystack.endsWith(needle);
    case 'matches':
      try {
        return new RegExp(c.value, 'i').test(ctx[c.field] ?? '');
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export async function ingestMessage(deps: Deps, env: IngestEnvelope, raw: Buffer): Promise<IngestOutcome> {
  const { cfg, db, store } = deps;

  if (raw.length > cfg.MAX_MESSAGE_BYTES) {
    return { status: 'rejected', reason: '552 5.3.4 Message too large', permanent: true };
  }

  const [owner] = await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
  if (!owner) return { status: 'rejected', reason: '451 4.3.0 Mailbox not configured', permanent: false };

  const parsed = await parseMime(raw);

  const recipients = env.to.map((r) => localpartOf(r, cfg.DOMAIN)).filter((lp): lp is string => lp !== null);
  if (recipients.length === 0) {
    return { status: 'rejected', reason: '550 5.1.1 Not a local recipient', permanent: true };
  }
  const primaryLp = recipients[0]!;

  // blocked sender checks
  const blocked = await db.select().from(blockedSenders).where(eq(blockedSenders.userId, owner.id));
  const senderDomain = parsed.from.address.includes('@')
    ? parsed.from.address.split('@')[1]!.toLowerCase()
    : '';
  if (
    blocked.some(
      (b) =>
        (b.kind === 'sender' && b.value === parsed.from.address.toLowerCase()) ||
        (b.kind === 'domain' && b.value === senderDomain),
    )
  ) {
    // accept silently and drop to spam quarantine below instead of rejecting (no information leak)
  }

  const spam = await checkRspamd(cfg, raw, env.clientIp);
  const virusWhole = await scanBuffer(cfg, raw);

  // alias resolution: exact → pattern → catch-all (discovered)
  const allAliases = await db.select().from(aliases).where(eq(aliases.userId, owner.id));
  let alias =
    allAliases.find((a) => !a.isPattern && a.localpart === primaryLp) ??
    allAliases.find((a) => !a.isPattern && a.localpart === stripPlus(primaryLp)) ??
    allAliases.find((a) => a.isPattern && wildcardMatch(a.localpart, primaryLp));

  if (alias?.blocked) {
    return { status: 'accepted', messageId: '' };
  }

  if (!alias) {
    const [created] = await db
      .insert(aliases)
      .values({
        id: nanoid(16),
        userId: owner.id,
        localpart: primaryLp,
        source: 'discovered',
      })
      .returning();
    alias = created!;
    if (deps.publish) {
      await deps.publish(owner.id, {
        type: 'alias:created',
        alias: {
          id: alias.id,
          localpart: alias.localpart,
          address: `${alias.localpart}@${cfg.DOMAIN}`,
          displayName: alias.displayName,
          color: alias.color,
          pinned: alias.pinned,
          outboundEnabled: alias.outboundEnabled,
          blocked: alias.blocked,
          isPattern: alias.isPattern,
          source: alias.source,
          signature: alias.signature,
          totalMessages: 0,
          unreadMessages: 0,
          lastMessageAt: null,
          createdAt: alias.createdAt.toISOString(),
        },
      });
    }
  }

  const fp = fingerprint(parsed.messageId, env, raw);
  const dup = await db.select({ id: messages.id }).from(messages).where(eq(messages.fingerprint, fp)).limit(1);
  if (dup.length > 0) {
    return { status: 'accepted', messageId: dup[0]!.id, duplicate: true };
  }

  // thread resolution
  let threadId: string | null = null;
  const candidateIds = [...parsed.references, ...(parsed.inReplyTo ? [parsed.inReplyTo] : [])];
  if (candidateIds.length > 0) {
    const found = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(and(eq(messages.userId, owner.id), inArray(messages.messageIdHeader, candidateIds)))
      .orderBy(desc(messages.receivedAt))
      .limit(1);
    threadId = found[0]?.threadId ?? null;
  }
  const normSubject = normalizeSubject(parsed.subject);
  if (!threadId && normSubject) {
    const found = await db
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.userId, owner.id), eq(threads.subject, normSubject)))
      .orderBy(desc(threads.updatedAt))
      .limit(1);
    threadId = found[0]?.id ?? null;
  }
  if (!threadId) {
    const [t] = await db
      .insert(threads)
      .values({ id: nanoid(16), userId: owner.id, subject: normSubject })
      .returning();
    threadId = t!.id;
  } else {
    await db.update(threads).set({ updatedAt: new Date(), subject: normSubject || undefined }).where(eq(threads.id, threadId));
  }

  // storage
  const messageId = nanoid(16);
  const rawKey = `raw/${messageId.slice(0, 2)}/${messageId}`;
  await store.put(rawKey, raw, 'message/rfc822');
  const headersKey = `headers/${messageId.slice(0, 2)}/${messageId}`;
  await store.put(headersKey, Buffer.from(JSON.stringify(parsed.headers)), 'application/json');

  const attRecords: { messageId: string; id: string; filename: string; contentType: string; size: number; storageKey: string; contentId: string | null; inline: boolean; virusStatus: 'clean' | 'infected' | 'skipped' | 'error' }[] = [];
  let anyInfected = virusWhole.status === 'infected';
  for (const att of parsed.attachments) {
    const attId = nanoid(16);
    const key = `att/${attId.slice(0, 2)}/${attId}`;
    await store.put(key, att.content, att.contentType);
    const scan = cfg.CLAMAV_HOST ? await scanBuffer(cfg, att.content) : virusWhole;
    if (scan.status === 'infected') anyInfected = true;
    attRecords.push({
      messageId,
      id: attId,
      filename: att.filename.replace(SAFE_NAME, '_').slice(0, 200),
      contentType: att.contentType,
      size: att.content.length,
      storageKey: key,
      contentId: att.contentId,
      inline: att.inline,
      virusStatus: scan.status,
    });
  }

  const senderBlocked =
    blocked.some(
      (b) =>
        (b.kind === 'sender' && b.value === parsed.from.address.toLowerCase()) ||
        (b.kind === 'domain' && senderDomain !== '' && b.value === senderDomain),
    );
  const folder: 'inbox' | 'spam' = spam.isSpam || senderBlocked ? 'spam' : 'inbox';

  const authResults = parseAuthResults(parsed.headers);

  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id: messageId,
      userId: owner.id,
      threadId,
      aliasId: alias!.id,
      folder,
      fingerprint: fp,
      messageIdHeader: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      envelopeFrom: env.from || null,
      envelopeTo: env.to.join(', '),
      fromAddress: parsed.from.address || null,
      fromName: parsed.from.name,
      to: parsed.to,
      cc: parsed.cc,
      bcc: parsed.bcc,
      replyTo: parsed.replyTo,
      subject: parsed.subject,
      receivedAt: parsed.date,
      textBody: parsed.textBody,
      htmlBody: parsed.htmlBody,
      rawKey,
      headersKey,
      size: raw.length,
      spamScore: spam.score,
      virusResult: anyInfected ? 'infected' : virusWhole.status,
      dkimResult: authResults.dkim,
      spfResult: authResults.spf,
      dmarcResult: authResults.dmarc,
      isAutoReply: parsed.isAutoReply,
      isListMessage: parsed.isListMessage,
      isBounce: parsed.isBounce,
      read: false,
    });
    const recValues: { id: string; messageId: string; kind: string; address: string; name: string | null }[] = [
      ...parsed.to.map((a) => ({ id: nanoid(16), messageId, kind: 'to', address: a.address, name: a.name ?? null })),
      ...parsed.cc.map((a) => ({ id: nanoid(16), messageId, kind: 'cc', address: a.address, name: a.name ?? null })),
      ...env.to.map((a) => ({ id: nanoid(16), messageId, kind: 'envelope', address: a.toLowerCase(), name: null })),
    ];
    if (recValues.length > 0) await tx.insert(messageRecipients).values(recValues);
    if (attRecords.length > 0) await tx.insert(attachments).values(attRecords);
    await tx
      .update(aliases)
      .set({ lastMessageAt: new Date() })
      .where(eq(aliases.id, alias!.id));
  });

  // rules
  await applyRules(deps, owner.id, messageId, {
    to: env.to.join(' '),
    from: `${parsed.from.name ?? ''} ${parsed.from.address}`,
    subject: parsed.subject,
    alias: `${alias.localpart}@${cfg.DOMAIN}`,
  });

  const summary = await buildSummary(deps, messageId);
  if (summary && deps.publish) {
    await deps.publish(owner.id, { type: 'message:new', message: summary });
  }

  return { status: 'accepted', messageId };
}

function parseAuthResults(headers: [string, string][]): { dkim: string | null; spf: string | null; dmarc: string | null } {
  const out = { dkim: null as string | null, spf: null as string | null, dmarc: null as string | null };
  for (const [name, value] of headers) {
    if (name.toLowerCase() !== 'authentication-results') continue;
    const dkim = value.match(/dkim=([a-z]+)/i);
    const spf = value.match(/spf=([a-z]+)/i);
    const dmarc = value.match(/dmarc=([a-z]+)/i);
    if (dkim && !out.dkim) out.dkim = dkim[1]!.toLowerCase();
    if (spf && !out.spf) out.spf = spf[1]!.toLowerCase();
    if (dmarc && !out.dmarc) out.dmarc = dmarc[1]!.toLowerCase();
  }
  return out;
}

async function applyRules(
  deps: Deps,
  userId: string,
  messageId: string,
  ctx: Record<string, string>,
): Promise<string[]> {
  const { db } = deps;
  const activeRules = await db
    .select()
    .from(rules)
    .where(and(eq(rules.userId, userId), eq(rules.enabled, true)))
    .orderBy(asc(rules.position));
  const explanations: string[] = [];
  for (const rule of activeRules) {
    const ok = rule.conditions.every((c) => matchesCondition(c as ConditionEval, ctx));
    if (!ok) continue;
    const matchedFields = rule.conditions.map((c) => `${c.field} ${c.op} "${c.value}"`).join(', ');
    for (const action of rule.actions) {
      switch (action.type) {
        case 'label': {
          if (!action.value) break;
          const existing = await db
            .select()
            .from(labels)
            .where(and(eq(labels.userId, userId), eq(labels.name, action.value)))
            .limit(1);
          let labelId = existing[0]?.id;
          if (!labelId) {
            const [l] = await db
              .insert(labels)
              .values({ id: nanoid(16), userId, name: action.value })
              .returning();
            labelId = l!.id;
          }
          await db.insert(messageLabels).values({ messageId, labelId }).onConflictDoNothing();
          break;
        }
        case 'archive':
          await db.update(messages).set({ folder: 'archive', archived: true }).where(eq(messages.id, messageId));
          break;
        case 'star':
          await db.update(messages).set({ starred: true }).where(eq(messages.id, messageId));
          break;
        case 'markRead':
          await db.update(messages).set({ read: true }).where(eq(messages.id, messageId));
          break;
        case 'spam':
          await db.update(messages).set({ folder: 'spam' }).where(eq(messages.id, messageId));
          break;
        case 'trash':
          await db.update(messages).set({ folder: 'trash', deletedAt: new Date() }).where(eq(messages.id, messageId));
          break;
        case 'block':
          break;
      }
    }
    const explanation = `Rule "${rule.name}" matched: ${matchedFields}`;
    explanations.push(explanation);
    await db.insert(ruleHits).values({ id: nanoid(16), ruleId: rule.id, messageId, explanation });
    await db.update(rules).set({ hitCount: sql`${rules.hitCount} + 1` }).where(eq(rules.id, rule.id));
  }
  return explanations;
}

export async function buildSummary(deps: Deps, messageId: string): Promise<MessageSummaryDto | null> {
  const { db, cfg } = deps;
  const rows = await db
    .select({ m: messages, a: aliases })
    .from(messages)
    .leftJoin(aliases, eq(messages.aliasId, aliases.id))
    .where(eq(messages.id, messageId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const m = row.m;
  const atts = await db.select({ inline: attachments.inline }).from(attachments).where(eq(attachments.messageId, messageId));
  const hits = await db.select({ explanation: ruleHits.explanation }).from(ruleHits).where(eq(ruleHits.messageId, messageId)).limit(1);
  const lbls = await db
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(messageLabels)
    .innerJoin(labels, eq(messageLabels.labelId, labels.id))
    .where(eq(messageLabels.messageId, messageId));
  return {
    id: m.id,
    threadId: m.threadId,
    aliasId: m.aliasId,
    aliasAddress: row.a ? `${row.a.localpart}@${cfg.DOMAIN}` : null,
    aliasColor: row.a?.color ?? null,
    folder: m.folder as MessageSummaryDto['folder'],
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    subject: m.subject,
    preview: (m.textBody ?? '').slice(0, 220),
    receivedAt: m.receivedAt.toISOString(),
    read: m.read,
    starred: m.starred,
    archived: m.archived,
    hasAttachments: atts.some((a) => !a.inline),
    spamScore: m.spamScore,
    labels: lbls,
    ruleExplanation: hits[0]?.explanation ?? null,
  };
}
