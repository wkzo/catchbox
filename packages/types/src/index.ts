import { z } from 'zod';

export const emailSchema = z
  .string()
  .max(320)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address');

export const localpartSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]([a-z0-9._*-]*[a-z0-9*])?$/i, 'Invalid localpart');

/* ---------- auth ---------- */
export const loginSchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(512),
  totpToken: z.string().length(6).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const setupSchema = z.object({
  email: emailSchema,
  displayName: z.string().min(1).max(120).default('Owner'),
  password: z.string().min(10).max(512),
});
export type SetupInput = z.infer<typeof setupSchema>;

/* ---------- aliases ---------- */
export const aliasUpdateSchema = z.object({
  displayName: z.string().max(120).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  pinned: z.boolean().optional(),
  outboundEnabled: z.boolean().optional(),
  blocked: z.boolean().optional(),
  signature: z.string().max(5000).nullable().optional(),
});
export type AliasUpdateInput = z.infer<typeof aliasUpdateSchema>;

export const aliasCreateSchema = z.object({
  localpart: localpartSchema,
  displayName: z.string().max(120).optional(),
  color: z.string().max(32).optional(),
});
export type AliasCreateInput = z.infer<typeof aliasCreateSchema>;

export interface AliasDto {
  id: string;
  localpart: string;
  address: string;
  displayName: string | null;
  color: string | null;
  pinned: boolean;
  outboundEnabled: boolean;
  blocked: boolean;
  isPattern: boolean;
  source: 'discovered' | 'manual' | 'pattern' | 'system';
  signature: string | null;
  totalMessages: number;
  unreadMessages: number;
  lastMessageAt: string | null;
  createdAt: string;
}

/* ---------- messages ---------- */
export type Folder = 'inbox' | 'archive' | 'spam' | 'trash' | 'sent' | 'drafts';

export interface AddressDto {
  address: string;
  name?: string;
}

export interface AttachmentDto {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  virusStatus: 'pending' | 'clean' | 'infected' | 'skipped' | 'error';
}

export interface MessageSummaryDto {
  id: string;
  threadId: string | null;
  aliasId: string | null;
  aliasAddress: string | null;
  aliasColor: string | null;
  folder: Folder;
  fromAddress: string | null;
  fromName: string | null;
  subject: string;
  preview: string;
  receivedAt: string;
  read: boolean;
  starred: boolean;
  archived: boolean;
  hasAttachments: boolean;
  spamScore: number;
  labels: { id: string; name: string; color: string | null }[];
  ruleExplanation: string | null;
}

export interface MessageDto extends MessageSummaryDto {
  to: AddressDto[];
  cc: AddressDto[];
  bcc: AddressDto[];
  replyTo: string | null;
  envelopeFrom: string | null;
  envelopeTo: string | null;
  textBody: string | null;
  htmlBody: string | null;
  attachments: AttachmentDto[];
  headers: [string, string][];
  dkimResult: string | null;
  spfResult: string | null;
  dmarcResult: string | null;
  virusResult: string;
  size: number;
  messageIdHeader: string | null;
  isListMessage?: boolean;
  isAutoReply?: boolean;
}

export const bulkActionSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  action: z.enum([
    'read',
    'unread',
    'star',
    'unstar',
    'archive',
    'trash',
    'deleteForever',
    'restore',
    'spam',
    'notSpam',
  ]),
});
export type BulkActionInput = z.infer<typeof bulkActionSchema>;

/* ---------- drafts & compose ---------- */
export const draftSchema = z.object({
  id: z.string().optional(),
  aliasId: z.string().optional(),
  to: z.array(emailSchema).max(50).default([]),
  cc: z.array(emailSchema).max(50).default([]),
  bcc: z.array(emailSchema).max(50).default([]),
  subject: z.string().max(998).default(''),
  textBody: z.string().max(1_000_000).default(''),
  htmlBody: z.string().max(2_000_000).optional(),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
});
export type DraftInput = z.infer<typeof draftSchema>;

export const sendSchema = draftSchema.extend({ draftId: z.string().optional() });
export type SendInput = z.infer<typeof sendSchema>;

export interface DraftDto {
  id: string;
  aliasId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string;
  htmlBody: string | null;
  threadId: string | null;
  inReplyTo: string | null;
  attachments: { id: string; filename: string; size: number }[];
  updatedAt: string;
}

/* ---------- rules ---------- */
export const ruleConditionSchema = z.object({
  field: z.enum(['to', 'from', 'subject', 'alias']),
  op: z.enum(['contains', 'equals', 'matches', 'startsWith', 'endsWith']),
  value: z.string().min(1).max(500),
});

export const ruleActionSchema = z.object({
  type: z.enum(['label', 'archive', 'star', 'markRead', 'spam', 'trash', 'block']),
  value: z.string().max(200).optional(),
});

export const ruleSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  conditions: z.array(ruleConditionSchema).min(1).max(10),
  actions: z.array(ruleActionSchema).min(1).max(10),
});
export type RuleInput = z.infer<typeof ruleSchema>;

export interface RuleDto extends RuleInput {
  id: string;
  position: number;
  hitCount: number;
}

/* ---------- blocked senders ---------- */
export const blockedSenderSchema = z.object({
  kind: z.enum(['sender', 'domain']),
  value: z.string().min(3).max(320),
});
export type BlockedSenderInput = z.infer<typeof blockedSenderSchema>;

/* ---------- search ---------- */
export const searchQuerySchema = z.object({
  q: z.string().max(500).default(''),
  folder: z.enum(['inbox', 'archive', 'spam', 'trash', 'sent', 'drafts', 'all']).optional(),
  alias: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  hasAttachment: z.coerce.boolean().optional(),
  unread: z.coerce.boolean().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export interface MessageListResponse {
  messages: MessageSummaryDto[];
  nextCursor: string | null;
  total: number;
}

/* ---------- settings ---------- */
export const profileSchema = z.object({
  displayName: z.string().min(1).max(120),
  theme: z.enum(['system', 'light', 'dark']).optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10).max(512),
});

export const savedViewSchema = z.object({
  name: z.string().min(1).max(120),
  query: z.string().min(1).max(500),
});
export type SavedViewInput = z.infer<typeof savedViewSchema>;

/* ---------- realtime ---------- */
export type RealtimeEvent =
  | { type: 'message:new'; message: MessageSummaryDto }
  | { type: 'message:updated'; id: string; changes: Partial<MessageSummaryDto> }
  | { type: 'outbound:status'; jobId: string; status: string; error?: string }
  | { type: 'alias:created'; alias: AliasDto }
  | { type: 'pong' };

/* ---------- diagnostics ---------- */
export interface DnsCheckDto {
  mx: { ok: boolean; detail: string };
  spf: { ok: boolean; detail: string };
  dkim: { ok: boolean; detail: string };
  dmarc: { ok: boolean; detail: string };
  ptr: { ok: boolean; detail: string };
  smtp: { ok: boolean; detail: string };
  tls: { ok: boolean; detail: string };
  blocklists: { list: string; listed: boolean; detail: string }[];
}
