import { sql, and, eq, inArray, desc, lt, or, isNull, count } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { bulkActionSchema, aliasUpdateSchema, aliasCreateSchema } from '@catchbox/types';
import type { MessageSummaryDto, Folder } from '@catchbox/types';
import {
  messages,
  aliases,
  attachments,
  labels,
  messageLabels,
  ruleHits,
} from '@catchbox/db';
import type { App } from '../lib/context.js';
import { httpError, requireCsrf, requireUser } from '../lib/auth.js';
import { publish } from '../lib/realtime.js';

const CURSOR = /^[\w-]+$/;

export function decodeCursor(cursor: string): { ts: Date; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const idx = raw.indexOf(':');
  const ms = Number(raw.slice(0, idx));
  const id = raw.slice(idx + 1);
  if (!Number.isFinite(ms) || !id) throw httpError(400, 'Invalid cursor');
  return { ts: new Date(ms), id };
}

export function encodeCursor(ts: Date, id: string) {
  return Buffer.from(`${ts.getTime()}:${id}`).toString('base64url');
}

const FOLDERS: Folder[] = ['inbox', 'archive', 'spam', 'trash', 'sent', 'drafts'];

interface ListParams {
  folder?: string;
  aliasId?: string;
  unread?: boolean;
  starred?: boolean;
  cursor?: string;
  limit?: number;
  threadId?: string;
}

export async function listMessages(app: App, userId: string, p: ListParams) {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 100);
  const conds = [eq(messages.userId, userId)];
  if (p.threadId) conds.push(eq(messages.threadId, p.threadId));
  if (p.folder && FOLDERS.includes(p.folder as Folder)) conds.push(eq(messages.folder, p.folder as Folder));
  if (p.aliasId) conds.push(eq(messages.aliasId, p.aliasId));
  if (p.unread) conds.push(eq(messages.read, false));
  if (p.starred) conds.push(eq(messages.starred, true));
  if (p.folder !== 'trash') conds.push(isNull(messages.deletedAt));
  if (p.cursor) {
    if (!CURSOR.test(p.cursor)) throw httpError(400, 'Invalid cursor');
    const { ts, id } = decodeCursor(p.cursor);
    conds.push(or(lt(messages.receivedAt, ts), and(eq(messages.receivedAt, ts), lt(messages.id, id)))!);
  }
  const rows = await app.ctx.db
    .select({
      id: messages.id,
      threadId: messages.threadId,
      aliasId: messages.aliasId,
      folder: messages.folder,
      fromAddress: messages.fromAddress,
      fromName: messages.fromName,
      subject: messages.subject,
      preview: sql<string>`coalesce(left(${messages.textBody}, 220), '')`,
      receivedAt: messages.receivedAt,
      read: messages.read,
      starred: messages.starred,
      archived: messages.archived,
      spamScore: messages.spamScore,
      aliasAddress: aliases.localpart,
      aliasColor: aliases.color,
    })
    .from(messages)
    .leftJoin(aliases, eq(messages.aliasId, aliases.id))
    .where(and(...conds))
    .orderBy(desc(messages.receivedAt), desc(messages.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const ids = page.map((r) => r.id);
  const [attRows, labelRows, hitRows] = await Promise.all([
    ids.length
      ? app.ctx.db
          .select({ messageId: attachments.messageId })
          .from(attachments)
          .where(and(inArray(attachments.messageId, ids), eq(attachments.inline, false)))
      : Promise.resolve([]),
    ids.length
      ? app.ctx.db
          .select({
            messageId: messageLabels.messageId,
            id: labels.id,
            name: labels.name,
            color: labels.color,
          })
          .from(messageLabels)
          .innerJoin(labels, eq(messageLabels.labelId, labels.id))
          .where(inArray(messageLabels.messageId, ids))
      : Promise.resolve([]),
    ids.length
      ? app.ctx.db.select({ messageId: ruleHits.messageId, explanation: ruleHits.explanation }).from(ruleHits).where(inArray(ruleHits.messageId, ids))
      : Promise.resolve([]),
  ]);
  const attSet = new Set(attRows.map((r) => r.messageId));
  const labelMap = new Map<string, { id: string; name: string; color: string | null }[]>();
  for (const l of labelRows) {
    const arr = labelMap.get(l.messageId) ?? [];
    arr.push({ id: l.id, name: l.name, color: l.color });
    labelMap.set(l.messageId, arr);
  }
  const hitMap = new Map(hitRows.map((h) => [h.messageId, h.explanation]));

  const out: MessageSummaryDto[] = page.map((r) => ({
    id: r.id,
    threadId: r.threadId,
    aliasId: r.aliasId,
    aliasAddress: r.aliasAddress ? `${r.aliasAddress}@${app.ctx.cfg.DOMAIN}` : null,
    aliasColor: r.aliasColor,
    folder: r.folder as Folder,
    fromAddress: r.fromAddress,
    fromName: r.fromName,
    subject: r.subject,
    preview: r.preview,
    receivedAt: r.receivedAt.toISOString(),
    read: r.read,
    starred: r.starred,
    archived: r.archived,
    hasAttachments: attSet.has(r.id),
    spamScore: r.spamScore,
    labels: labelMap.get(r.id) ?? [],
    ruleExplanation: hitMap.get(r.id) ?? null,
  }));
  const last = page[page.length - 1];
  return {
    messages: out,
    nextCursor: hasMore && last ? encodeCursor(last.receivedAt, last.id) : null,
    total: out.length,
  };
}

export async function messagesRoutes(app: App) {
  app.get('/api/messages', { onRequest: requireUser }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return listMessages(app, req.user!.id, {
      folder: q['folder'],
      aliasId: q['aliasId'],
      unread: q['unread'] === '1',
      starred: q['starred'] === '1',
      cursor: q['cursor'],
      limit: q['limit'] ? Number(q['limit']) : undefined,
    });
  });

  app.get('/api/counters', { onRequest: requireUser }, async (req) => {
    const rows = await app.ctx.db
      .select({ folder: messages.folder, n: count() })
      .from(messages)
      .where(and(eq(messages.userId, req.user!.id), eq(messages.read, false), isNull(messages.deletedAt)))
      .groupBy(messages.folder);
    const byAlias = await app.ctx.db
      .select({ aliasId: messages.aliasId, n: count() })
      .from(messages)
      .where(and(eq(messages.userId, req.user!.id), eq(messages.read, false), isNull(messages.deletedAt), eq(messages.folder, 'inbox')))
      .groupBy(messages.aliasId);
    const out: Record<string, number> = { inbox: 0, spam: 0, trash: 0, archive: 0, sent: 0, drafts: 0 };
    for (const r of rows) out[r.folder] = r.n;
    return { folders: out, aliases: Object.fromEntries(byAlias.map((r) => [r.aliasId ?? 'none', r.n])) };
  });

  app.get('/api/messages/:id', { onRequest: requireUser }, async (req) => {
    const { id } = req.params as { id: string };
    const [m] = await app.ctx.db
      .select({ message: messages, aliasLocalpart: aliases.localpart, aliasColor: aliases.color })
      .from(messages)
      .leftJoin(aliases, eq(messages.aliasId, aliases.id))
      .where(and(eq(messages.id, id), eq(messages.userId, req.user!.id)))
      .limit(1);
    if (!m) throw httpError(404, 'Message not found');
    const msg = m.message;
    const [atts, hits, lbls] = await Promise.all([
      app.ctx.db.select().from(attachments).where(eq(attachments.messageId, id)),
      app.ctx.db.select().from(ruleHits).where(eq(ruleHits.messageId, id)).limit(5),
      app.ctx.db
        .select({ id: labels.id, name: labels.name, color: labels.color })
        .from(messageLabels)
        .innerJoin(labels, eq(messageLabels.labelId, labels.id))
        .where(eq(messageLabels.messageId, id)),
    ]);
    let headers: [string, string][] = [];
    if (msg.headersKey) {
      const raw = await app.ctx.store.get(msg.headersKey);
      if (raw) headers = JSON.parse(raw.toString('utf8')) as [string, string][];
    }
    if (!msg.read) {
      await app.ctx.db.update(messages).set({ read: true }).where(eq(messages.id, id));
    }
    return {
      id: msg.id,
      threadId: msg.threadId,
      aliasId: msg.aliasId,
      aliasAddress: m.aliasLocalpart ? `${m.aliasLocalpart}@${app.ctx.cfg.DOMAIN}` : null,
      aliasColor: m.aliasColor,
      folder: msg.folder,
      fromAddress: msg.fromAddress,
      fromName: msg.fromName,
      subject: msg.subject,
      preview: (msg.textBody ?? '').slice(0, 220),
      receivedAt: msg.receivedAt.toISOString(),
      read: true,
      starred: msg.starred,
      archived: msg.archived,
      hasAttachments: atts.some((a) => !a.inline),
      spamScore: msg.spamScore,
      labels: lbls,
      ruleExplanation: hits[0]?.explanation ?? null,
      to: msg.to,
      cc: msg.cc,
      bcc: msg.bcc,
      replyTo: msg.replyTo,
      envelopeFrom: msg.envelopeFrom,
      envelopeTo: msg.envelopeTo,
      textBody: msg.textBody,
      htmlBody: msg.htmlBody,
      attachments: atts.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        inline: a.inline,
        virusStatus: a.virusStatus,
      })),
      headers,
      dkimResult: msg.dkimResult,
      spfResult: msg.spfResult,
      dmarcResult: msg.dmarcResult,
      virusResult: msg.virusResult,
      size: msg.size,
      messageIdHeader: msg.messageIdHeader,
      isListMessage: msg.isListMessage,
      isAutoReply: msg.isAutoReply,
    };
  });

  app.patch('/api/messages/:id', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Partial<{ read: boolean; starred: boolean; folder: Folder }>;
    const set: Record<string, unknown> = {};
    if (typeof body.read === 'boolean') set['read'] = body.read;
    if (typeof body.starred === 'boolean') set['starred'] = body.starred;
    if (body.folder && FOLDERS.includes(body.folder)) {
      set['folder'] = body.folder;
      set['archived'] = body.folder === 'archive';
      set['deletedAt'] = body.folder === 'trash' ? new Date() : null;
    }
    if (Object.keys(set).length === 0) throw httpError(400, 'Nothing to update');
    await app.ctx.db.update(messages).set(set).where(and(eq(messages.id, id), eq(messages.userId, req.user!.id)));
    await publish(app, req.user!.id, { type: 'message:updated', id, changes: set as Partial<MessageSummaryDto> });
    return { ok: true };
  });

  app.post('/api/messages/bulk', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const input = bulkActionSchema.parse(req.body);
    const where = and(inArray(messages.id, input.ids), eq(messages.userId, req.user!.id));
    switch (input.action) {
      case 'read':
        await app.ctx.db.update(messages).set({ read: true }).where(where);
        break;
      case 'unread':
        await app.ctx.db.update(messages).set({ read: false }).where(where);
        break;
      case 'star':
        await app.ctx.db.update(messages).set({ starred: true }).where(where);
        break;
      case 'unstar':
        await app.ctx.db.update(messages).set({ starred: false }).where(where);
        break;
      case 'archive':
        await app.ctx.db.update(messages).set({ folder: 'archive', archived: true }).where(where);
        break;
      case 'trash':
        await app.ctx.db
          .update(messages)
          .set({ folder: 'trash', deletedAt: new Date() })
          .where(where);
        break;
      case 'restore':
        await app.ctx.db
          .update(messages)
          .set({ folder: 'inbox', deletedAt: null, archived: false })
          .where(where);
        break;
      case 'deleteForever':
        await app.ctx.db.delete(messages).where(where);
        break;
      case 'spam':
        await app.ctx.db.update(messages).set({ folder: 'spam' }).where(where);
        break;
      case 'notSpam':
        await app.ctx.db.update(messages).set({ folder: 'inbox', spamScore: 0 }).where(where);
        break;
    }
    return { ok: true, affected: input.ids.length };
  });

  app.get('/api/threads/:id', { onRequest: requireUser }, async (req) => {
    const { id } = req.params as { id: string };
    return listMessages(app, req.user!.id, { threadId: id, limit: 100 });
  });

  app.post('/api/messages/:id/labels', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    const { labelId } = (req.body ?? {}) as { labelId?: string };
    if (!labelId) throw httpError(400, 'labelId required');
    await app.ctx.db
      .insert(messageLabels)
      .values({ messageId: id, labelId })
      .onConflictDoNothing();
    return { ok: true };
  });

  app.delete('/api/messages/:id/labels/:labelId', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id, labelId } = req.params as { id: string; labelId: string };
    await app.ctx.db
      .delete(messageLabels)
      .where(and(eq(messageLabels.messageId, id), eq(messageLabels.labelId, labelId)));
    return { ok: true };
  });
}

export async function aliasRoutes(app: App) {
  app.get('/api/aliases', { onRequest: requireUser }, async (req) => {
    const rows = await app.ctx.db
      .select({ alias: aliases })
      .from(aliases)
      .where(eq(aliases.userId, req.user!.id))
      .orderBy(desc(aliases.pinned), aliases.localpart);

    const totalRows = await app.ctx.db
      .select({ aliasId: messages.aliasId, n: count() })
      .from(messages)
      .where(and(eq(messages.userId, req.user!.id), isNull(messages.deletedAt)))
      .groupBy(messages.aliasId);
    const unreadRows = await app.ctx.db
      .select({ aliasId: messages.aliasId, n: count() })
      .from(messages)
      .where(and(eq(messages.userId, req.user!.id), eq(messages.read, false), isNull(messages.deletedAt)))
      .groupBy(messages.aliasId);
    const totalMap = new Map(totalRows.map((r) => [r.aliasId, r.n]));
    const unreadMap = new Map(unreadRows.map((r) => [r.aliasId, r.n]));

    return {
      aliases: rows.map((r) => ({
        id: r.alias.id,
        localpart: r.alias.localpart,
        address: `${r.alias.localpart}@${app.ctx.cfg.DOMAIN}`,
        displayName: r.alias.displayName,
        color: r.alias.color,
        pinned: r.alias.pinned,
        outboundEnabled: r.alias.outboundEnabled,
        blocked: r.alias.blocked,
        isPattern: r.alias.isPattern,
        source: r.alias.source,
        signature: r.alias.signature,
        totalMessages: Number(totalMap.get(r.alias.id) ?? 0),
        unreadMessages: Number(unreadMap.get(r.alias.id) ?? 0),
        lastMessageAt: r.alias.lastMessageAt?.toISOString() ?? null,
        createdAt: r.alias.createdAt.toISOString(),
      })),
    };
  });

  app.post('/api/aliases', { onRequest: [requireUser, requireCsrf] }, async (req, reply) => {
    const input = aliasCreateSchema.parse(req.body);
    const localpart = input.localpart.toLowerCase();
    if (['postmaster', 'abuse', 'mailer-daemon'].includes(localpart)) {
      throw httpError(400, 'This localpart is reserved');
    }
    const existing = await app.ctx.db
      .select({ id: aliases.id })
      .from(aliases)
      .where(and(eq(aliases.userId, req.user!.id), eq(aliases.localpart, localpart)))
      .limit(1);
    if (existing.length > 0) throw httpError(409, 'Alias already exists');
    const isPattern = localpart.includes('*');
    const alias = {
      id: nanoid(16),
      userId: req.user!.id,
      localpart,
      displayName: input.displayName ?? null,
      color: input.color ?? null,
      isPattern,
      source: isPattern ? ('pattern' as const) : ('manual' as const),
    };
    await app.ctx.db.insert(aliases).values(alias);
    return reply.code(201).send({ id: alias.id });
  });

  app.patch('/api/aliases/:id', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    const input = aliasUpdateSchema.parse(req.body);
    await app.ctx.db
      .update(aliases)
      .set(input as Record<string, unknown>)
      .where(and(eq(aliases.id, id), eq(aliases.userId, req.user!.id)));
    return { ok: true };
  });

  app.delete('/api/aliases/:id', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    const [alias] = await app.ctx.db
      .select()
      .from(aliases)
      .where(and(eq(aliases.id, id), eq(aliases.userId, req.user!.id)))
      .limit(1);
    if (!alias) throw httpError(404, 'Alias not found');
    if (alias.source === 'system') throw httpError(400, 'System aliases cannot be deleted; block it instead');
    if (alias.source === 'discovered') {
      await app.ctx.db.update(aliases).set({ blocked: true }).where(eq(aliases.id, id));
      return { ok: true, blocked: true };
    }
    await app.ctx.db.delete(aliases).where(eq(aliases.id, id));
    return { ok: true };
  });
}
