import { sql, and, eq, desc, lt, or, isNull, like, gte, lte, inArray } from 'drizzle-orm';
import type { App } from '../lib/context.js';
import { requireUser } from "../lib/auth.js";
import { messages, aliases, attachments } from '@catchbox/db';
import { decodeCursor, encodeCursor } from './messages.js';
import type { MessageSummaryDto, Folder } from '@catchbox/types';

interface ParsedQuery {
  freeText: string[];
  from?: string;
  to?: string;
  alias?: string;
  subject?: string;
  hasAttachment?: boolean;
  unread?: boolean;
  after?: string;
  before?: string;
  folder?: string;
}

export function parseSearchQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { freeText: [] };
  const re = /(from|to|alias|subject|has|is|after|before|in):("([^"]*)"|\S+)/g;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  const parts: string[] = [];
  while ((m = re.exec(q)) !== null) {
    parts.push(q.slice(lastIndex, m.index));
    lastIndex = re.lastIndex;
    const key = m[1]!;
    const value = (m[3] ?? m[2] ?? '').trim();
    switch (key) {
      case 'from':
        out.from = value;
        break;
      case 'to':
        out.to = value;
        break;
      case 'alias':
        out.alias = value;
        break;
      case 'subject':
        out.subject = value;
        break;
      case 'has':
        if (value === 'attachment') out.hasAttachment = true;
        break;
      case 'is':
        if (value === 'unread') out.unread = true;
        break;
      case 'after':
        out.after = value;
        break;
      case 'before':
        out.before = value;
        break;
      case 'in':
        out.folder = value;
        break;
    }
  }
  parts.push(q.slice(lastIndex));
  for (const part of parts.join(' ').split(/\s+/)) {
    if (part) out.freeText.push(part);
  }
  return out;
}

function toTsQuery(terms: string[]) {
  return terms
    .map((t) => t.replace(/['\\%_()&|!:]/g, ' ').trim())
    .filter(Boolean)
    .map((t) => `${t.split(/\s+/)[0]}:*`)
    .join(' & ');
}

export async function searchRoutes(app: App) {
  app.get('/api/search', { onRequest: requireUser }, async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const parsed = parseSearchQuery(query['q'] ?? '');
    const limit = Math.min(Math.max(Number(query['limit'] ?? 50), 1), 100);
    const userId = req.user!.id;

    const conds = [eq(messages.userId, userId), isNull(messages.deletedAt)];
    if (parsed.from) {
      conds.push(
        or(
          like(messages.fromAddress, `%${parsed.from}%`),
          like(messages.fromName, `%${parsed.from}%`),
        )!,
      );
    }
    if (parsed.to) {
      conds.push(
        sql`${messages.id} in (select message_id from message_recipients where address like ${'%' + parsed.to + '%'})`,
      );
    }
    if (parsed.subject) conds.push(like(messages.subject, `%${parsed.subject}%`));
    if (parsed.unread) conds.push(eq(messages.read, false));
    if (parsed.hasAttachment) {
      conds.push(
        sql`${messages.id} in (select message_id from attachments where inline = false)`,
      );
    }
    if (parsed.after) conds.push(gte(messages.receivedAt, new Date(parsed.after)));
    if (parsed.before) conds.push(lte(messages.receivedAt, new Date(parsed.before)));
    const folder = parsed.folder ?? query['folder'];
    if (folder && ['inbox', 'archive', 'spam', 'trash', 'sent'].includes(folder)) {
      conds.push(eq(messages.folder, folder as Folder));
    }
    if (parsed.alias ?? query['alias']) {
      const lp = (parsed.alias ?? query['alias']!).replace(`@${app.ctx.cfg.DOMAIN}`, '');
      conds.push(
        sql`${messages.aliasId} in (select id from aliases where localpart = ${lp})`,
      );
    }
    if (parsed.freeText.length > 0) {
      conds.push(sql`search_vector @@ to_tsquery('simple', ${toTsQuery(parsed.freeText)})` as never);
    }
    if (query['cursor']) {
      const { ts, id } = decodeCursor(query['cursor']);
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
    const attRows = ids.length
      ? await app.ctx.db
          .select({ messageId: attachments.messageId })
          .from(attachments)
          .where(and(inArray(attachments.messageId, ids), eq(attachments.inline, false)))
      : [];
    const attSet = new Set(attRows.map((r) => r.messageId));
    const last = page[page.length - 1];
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
      labels: [],
      ruleExplanation: null,
    }));
    return {
      messages: out,
      nextCursor: hasMore && last ? encodeCursor(last.receivedAt, last.id) : null,
      total: out.length,
    };
  });
}
