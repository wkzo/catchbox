import PostalMime from 'postal-mime';
import type { Address, Email } from "postal-mime";
import { sanitizeEmailHtml, stripHtmlToText } from './sanitize.js';

export interface ParsedMessage {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: { address: string; name: string | null };
  to: { address: string; name?: string }[];
  cc: { address: string; name?: string }[];
  bcc: { address: string; name?: string }[];
  replyTo: string | null;
  subject: string;
  date: Date;
  textBody: string | null;
  htmlBody: string | null;
  headers: [string, string][];
  attachments: {
    filename: string;
    contentType: string;
    content: Buffer;
    contentId: string | null;
    inline: boolean;
  }[];
  isAutoReply: boolean;
  isBounce: boolean;
  isListMessage: boolean;
}

function flattenAddress(a: Address | undefined): { address: string; name: string | null } {
  if (!a || !('address' in a) || !a.address) return { address: '', name: null };
  return { address: a.address.toLowerCase(), name: a.name || null };
}

function flattenList(list?: Address[]): { address: string; name?: string }[] {
  if (!list) return [];
  const out: { address: string; name?: string }[] = [];
  for (const a of list) {
    if ('group' in a && a.group) {
      for (const m of a.group) if (m.address) out.push({ address: m.address.toLowerCase(), name: m.name || undefined });
    } else if ('address' in a && a.address) {
      out.push({ address: a.address.toLowerCase(), name: a.name || undefined });
    }
  }
  return out.slice(0, 100);
}

function extractIds(header: string | undefined): string[] {
  if (!header) return [];
  return [...header.matchAll(/<[^>]+>/g)].map((m) => m[0]).slice(0, 50);
}

export async function parseMime(raw: Buffer): Promise<ParsedMessage> {
  let email: Email;
  try {
    email = await PostalMime.parse(raw);
  } catch {
    // malformed MIME: degrade to treating the whole thing as text
    const text = raw.toString('utf8').slice(0, 200_000);
    return {
      messageId: null,
      inReplyTo: null,
      references: [],
      from: { address: '', name: null },
      to: [],
      cc: [],
      bcc: [],
      replyTo: null,
      subject: '(unparseable message)',
      date: new Date(),
      textBody: text,
      htmlBody: null,
      headers: [],
      attachments: [],
      isAutoReply: false,
      isBounce: false,
      isListMessage: false,
    };
  }

  const headerMap = new Map<string, string>();
  for (const h of email.headers) {
    if (!headerMap.has(h.key)) headerMap.set(h.key, h.value);
  }
  const from = flattenAddress(email.from);
  const autoReply =
    /^(auto-reply|auto_reply|auto generated|no-?reply)/i.test(headerMap.get('x-autoresponse-suppress') ?? '') ||
    /auto[- ]?(replied|generated)/i.test(headerMap.get('x-precedence') ?? '') ||
    (headerMap.get('auto-submitted') ?? '').toLowerCase() !== 'no';
  const bounceFrom = /mailer-daemon|postmaster/i.test(from.address);
  const contentType = headerMap.get('content-type') ?? '';

  let textBody = email.text ?? null;
  const rawHtml = typeof email.html === 'string' ? email.html : null;
  const htmlBody = rawHtml ? sanitizeEmailHtml(rawHtml) : null;
  if (!textBody && rawHtml) textBody = stripHtmlToText(rawHtml);
  if (textBody && textBody.length > 2_000_000) textBody = textBody.slice(0, 2_000_000);

  const attachments: ParsedMessage['attachments'] = [];
  for (const att of email.attachments.slice(0, 100)) {
    const content =
      att.content instanceof ArrayBuffer
        ? Buffer.from(att.content)
        : typeof att.content === 'string'
          ? Buffer.from(att.content, 'utf8')
          : Buffer.from(att.content as Uint8Array);
    attachments.push({
      filename: (att.filename ?? 'attachment').slice(0, 200),
      contentType: att.mimeType || 'application/octet-stream',
      content,
      contentId: att.contentId ? att.contentId.replace(/[<>]/g, '') : null,
      inline: att.disposition === 'inline' || Boolean(att.contentId),
    });
  }

  const subjectRaw = email.subject ?? '';
  const subject = subjectRaw.length > 998 ? subjectRaw.slice(0, 998) : subjectRaw;

  let date = new Date();
  if (email.date) {
    const d = new Date(email.date);
    if (!Number.isNaN(d.getTime())) date = d;
  }
  // reject absurd dates (malformed headers)
  const year = date.getUTCFullYear();
  if (year < 1990 || year > 2100) date = new Date();

  return {
    messageId: email.messageId ? email.messageId.trim().slice(0, 500) : null,
    inReplyTo: email.inReplyTo ? extractIds(email.inReplyTo)[0] ?? null : null,
    references: extractIds(email.references),
    from,
    to: flattenList(email.to),
    cc: flattenList(email.cc),
    bcc: flattenList(email.bcc),
    replyTo: flattenList(email.replyTo)[0]?.address ?? null,
    subject,
    date,
    textBody,
    htmlBody,
    headers: email.headerLines
      .map((h) => {
        const idx = h.line.indexOf(':');
        if (idx === -1) return [h.line, ''] as [string, string];
        return [h.line.slice(0, idx).trim(), h.line.slice(idx + 1).trim()] as [string, string];
      })
      .slice(0, 200),
    attachments,
    isAutoReply: autoReply,
    isBounce: bounceFrom && /delivery status|failure|undeliverable/i.test(subject + ' ' + contentType),
    isListMessage: Boolean(headerMap.get('list-id') || headerMap.get('list-unsubscribe')),
  };
}

export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  // strip leading Re:/Fwd:/Fw:/Aw: chains
  for (;;) {
    const next = s.replace(/^(re|fwd|fw|aw|sv|vs|ref|tr|отв|пересылка)\s*(\[\d+\])?\s*:\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 500);
}
