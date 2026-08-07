import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  real,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const folderEnum = pgEnum('folder', ['inbox', 'archive', 'spam', 'trash', 'sent', 'drafts']);
export const aliasSourceEnum = pgEnum('alias_source', ['discovered', 'manual', 'pattern', 'system']);
export const outboundStatusEnum = pgEnum('outbound_status', [
  'queued',
  'sending',
  'sent',
  'failed',
  'bounced',
]);
export const virusStatusEnum = pgEnum('virus_status', [
  'pending',
  'clean',
  'infected',
  'skipped',
  'error',
]);

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull().default('Owner'),
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  theme: text('theme').notNull().default('system'),
  recoveryKeyHash: text('recovery_key_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const aliases = pgTable(
  'aliases',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localpart: text('localpart').notNull(),
    displayName: text('display_name'),
    color: text('color'),
    pinned: boolean('pinned').notNull().default(false),
    outboundEnabled: boolean('outbound_enabled').notNull().default(true),
    blocked: boolean('blocked').notNull().default(false),
    isPattern: boolean('is_pattern').notNull().default(false),
    source: aliasSourceEnum('source').notNull().default('manual'),
    signature: text('signature'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('aliases_user_localpart_uq').on(t.userId, t.localpart),
    index('aliases_user_idx').on(t.userId),
  ],
);

export const mailboxes = pgTable(
  'mailboxes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('custom'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mailboxes_user_name_uq').on(t.userId, t.name)],
);

export const threads = pgTable(
  'threads',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('threads_user_idx').on(t.userId)],
);

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    aliasId: text('alias_id').references(() => aliases.id, { onDelete: 'set null' }),
    mailboxId: text('mailbox_id').references(() => mailboxes.id, { onDelete: 'set null' }),
    folder: folderEnum('folder').notNull().default('inbox'),
    fingerprint: text('fingerprint').notNull(),
    messageIdHeader: text('message_id_header'),
    inReplyTo: text('in_reply_to'),
    references: jsonb('references').$type<string[]>().notNull().default([]),
    envelopeFrom: text('envelope_from'),
    envelopeTo: text('envelope_to'),
    fromAddress: text('from_address'),
    fromName: text('from_name'),
    to: jsonb('rcpt_to').$type<{ address: string; name?: string }[]>().notNull().default([]),
    cc: jsonb('rcpt_cc').$type<{ address: string; name?: string }[]>().notNull().default([]),
    bcc: jsonb('rcpt_bcc').$type<{ address: string; name?: string }[]>().notNull().default([]),
    replyTo: text('reply_to'),
    subject: text('subject').notNull().default(''),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    rawKey: text('raw_key'),
    size: integer('size').notNull().default(0),
    spamScore: real('spam_score').notNull().default(0),
    virusResult: virusStatusEnum('virus_result').notNull().default('pending'),
    dkimResult: text('dkim_result'),
    spfResult: text('spf_result'),
    dmarcResult: text('dmarc_result'),
    isAutoReply: boolean('is_auto_reply').notNull().default(false),
    isListMessage: boolean('is_list_message').notNull().default(false),
    isBounce: boolean('is_bounce').notNull().default(false),
    read: boolean('read').notNull().default(false),
    starred: boolean('starred').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    headersKey: text('headers_key'),
  },
  (t) => [
    uniqueIndex('messages_fingerprint_uq').on(t.fingerprint),
    index('messages_user_folder_idx').on(t.userId, t.folder, t.receivedAt),
    index('messages_alias_idx').on(t.aliasId),
    index('messages_thread_idx').on(t.threadId),
    index('messages_message_id_idx').on(t.messageIdHeader),
    index('messages_search_idx').on(t.userId),
  ],
);

export const messageRecipients = pgTable(
  'message_recipients',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    address: text('address').notNull(),
    name: text('name'),
  },
  (t) => [index('message_recipients_message_idx').on(t.messageId)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    size: integer('size').notNull().default(0),
    storageKey: text('storage_key').notNull(),
    contentId: text('content_id'),
    inline: boolean('inline').notNull().default(false),
    virusStatus: virusStatusEnum('virus_status').notNull().default('pending'),
  },
  (t) => [index('attachments_message_idx').on(t.messageId)],
);

export const drafts = pgTable(
  'drafts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    aliasId: text('alias_id').references(() => aliases.id, { onDelete: 'set null' }),
    threadId: text('thread_id'),
    inReplyTo: text('in_reply_to'),
    to: jsonb('rcpt_to').$type<string[]>().notNull().default([]),
    cc: jsonb('rcpt_cc').$type<string[]>().notNull().default([]),
    bcc: jsonb('rcpt_bcc').$type<string[]>().notNull().default([]),
    subject: text('subject').notNull().default(''),
    textBody: text('text_body').notNull().default(''),
    htmlBody: text('html_body'),
    attachments: jsonb('attachments')
      .$type<{ id: string; filename: string; contentType: string; size: number; storageKey: string }[]>()
      .notNull()
      .default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('drafts_user_idx').on(t.userId, t.updatedAt)],
);

export const labels = pgTable(
  'labels',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
  },
  (t) => [uniqueIndex('labels_user_name_uq').on(t.userId, t.name)],
);

export const messageLabels = pgTable(
  'message_labels',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('message_labels_pk').on(t.messageId, t.labelId)],
);

export const rules = pgTable(
  'rules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    position: integer('position').notNull().default(0),
    conditions: jsonb(
      'conditions',
    )
      .$type<{ field: string; op: string; value: string }[]>()
      .notNull()
      .default([]),
    actions: jsonb('actions').$type<{ type: string; value?: string }[]>().notNull().default([]),
    hitCount: integer('hit_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rules_user_idx').on(t.userId, t.position)],
);

export const ruleHits = pgTable(
  'rule_hits',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    explanation: text('explanation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rule_hits_message_idx').on(t.messageId)],
);

export const blockedSenders = pgTable(
  'blocked_senders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('blocked_senders_uq').on(t.userId, t.kind, t.value)],
);

export const outboundJobs = pgTable(
  'outbound_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    aliasId: text('alias_id').references(() => aliases.id, { onDelete: 'set null' }),
    draftId: text('draft_id'),
    status: outboundStatusEnum('status').notNull().default('queued'),
    transport: text('transport').notNull(),
    to: jsonb('rcpt_to').$type<string[]>().notNull().default([]),
    cc: jsonb('rcpt_cc').$type<string[]>().notNull().default([]),
    bcc: jsonb('rcpt_bcc').$type<string[]>().notNull().default([]),
    subject: text('subject').notNull().default(''),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    rawKey: text('raw_key'),
    messageIdHeader: text('message_id_header'),
    inReplyTo: text('in_reply_to'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('outbound_jobs_status_idx').on(t.status)],
);

export const deliveryAttempts = pgTable(
  'delivery_attempts',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => outboundJobs.id, { onDelete: 'cascade' }),
    transport: text('transport').notNull(),
    status: text('status').notNull(),
    response: text('response'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('delivery_attempts_job_idx').on(t.jobId)],
);

export const savedViews = pgTable(
  'saved_views',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    query: text('query').notNull(),
  },
  (t) => [index('saved_views_user_idx').on(t.userId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_user_idx').on(t.userId, t.createdAt)],
);
