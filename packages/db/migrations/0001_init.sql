-- 0001_init.sql — initial schema for example.com mail

create extension if not exists pgcrypto;

create type folder as enum ('inbox','archive','spam','trash','sent','drafts');
create type alias_source as enum ('discovered','manual','pattern','system');
create type outbound_status as enum ('queued','sending','sent','failed','bounced');
create type virus_status as enum ('pending','clean','infected','skipped','error');

create table users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  display_name text not null default 'Owner',
  totp_secret text,
  totp_enabled boolean not null default false,
  theme text not null default 'system',
  recovery_key_hash text,
  created_at timestamptz not null default now()
);

create table sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index sessions_user_idx on sessions(user_id);

create table aliases (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  localpart text not null,
  display_name text,
  color text,
  pinned boolean not null default false,
  outbound_enabled boolean not null default true,
  blocked boolean not null default false,
  is_pattern boolean not null default false,
  source alias_source not null default 'manual',
  signature text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);
create unique index aliases_user_localpart_uq on aliases(user_id, localpart);
create index aliases_user_idx on aliases(user_id);

create table mailboxes (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  kind text not null default 'custom',
  created_at timestamptz not null default now()
);
create unique index mailboxes_user_name_uq on mailboxes(user_id, name);

create table threads (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  subject text not null default '',
  updated_at timestamptz not null default now()
);
create index threads_user_idx on threads(user_id);

create table messages (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  thread_id text references threads(id) on delete set null,
  alias_id text references aliases(id) on delete set null,
  mailbox_id text references mailboxes(id) on delete set null,
  folder folder not null default 'inbox',
  fingerprint text not null,
  message_id_header text,
  in_reply_to text,
  "references" jsonb not null default '[]',
  envelope_from text,
  envelope_to text,
  from_address text,
  from_name text,
  rcpt_to jsonb not null default '[]',
  rcpt_cc jsonb not null default '[]',
  rcpt_bcc jsonb not null default '[]',
  reply_to text,
  subject text not null default '',
  received_at timestamptz not null default now(),
  text_body text,
  html_body text,
  raw_key text,
  size integer not null default 0,
  spam_score real not null default 0,
  virus_result virus_status not null default 'pending',
  dkim_result text,
  spf_result text,
  dmarc_result text,
  is_auto_reply boolean not null default false,
  is_list_message boolean not null default false,
  is_bounce boolean not null default false,
  read boolean not null default false,
  starred boolean not null default false,
  archived boolean not null default false,
  deleted_at timestamptz,
  headers_key text,
  search_vector tsvector
);
create unique index messages_fingerprint_uq on messages(fingerprint);
create index messages_user_folder_idx on messages(user_id, folder, received_at desc);
create index messages_alias_idx on messages(alias_id);
create index messages_thread_idx on messages(thread_id);
create index messages_message_id_idx on messages(message_id_header);
create index messages_search_idx on messages using gin(search_vector);

create function messages_search_vector_update() returns trigger as $$
begin
  new.search_vector :=
    setweight(to_tsvector('simple', coalesce(new.subject,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.from_name,'') || ' ' || coalesce(new.from_address,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.text_body,'')), 'C');
  return new;
end;
$$ language plpgsql;

create trigger messages_search_vector_trg
  before insert or update of subject, from_name, from_address, text_body on messages
  for each row execute function messages_search_vector_update();

create table message_recipients (
  id text primary key,
  message_id text not null references messages(id) on delete cascade,
  kind text not null,
  address text not null,
  name text
);
create index message_recipients_message_idx on message_recipients(message_id);
create index message_recipients_address_idx on message_recipients(address);

create table attachments (
  id text primary key,
  message_id text not null references messages(id) on delete cascade,
  filename text not null,
  content_type text not null default 'application/octet-stream',
  size integer not null default 0,
  storage_key text not null,
  content_id text,
  inline boolean not null default false,
  virus_status virus_status not null default 'pending'
);
create index attachments_message_idx on attachments(message_id);

create table drafts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  alias_id text references aliases(id) on delete set null,
  thread_id text,
  in_reply_to text,
  rcpt_to jsonb not null default '[]',
  rcpt_cc jsonb not null default '[]',
  rcpt_bcc jsonb not null default '[]',
  subject text not null default '',
  text_body text not null default '',
  html_body text,
  attachments jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index drafts_user_idx on drafts(user_id, updated_at desc);

create table labels (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  color text
);
create unique index labels_user_name_uq on labels(user_id, name);

create table message_labels (
  message_id text not null references messages(id) on delete cascade,
  label_id text not null references labels(id) on delete cascade
);
create unique index message_labels_pk on message_labels(message_id, label_id);

create table rules (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  position integer not null default 0,
  conditions jsonb not null default '[]',
  actions jsonb not null default '[]',
  hit_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index rules_user_idx on rules(user_id, position);

create table rule_hits (
  id text primary key,
  rule_id text not null references rules(id) on delete cascade,
  message_id text not null references messages(id) on delete cascade,
  explanation text,
  created_at timestamptz not null default now()
);
create index rule_hits_message_idx on rule_hits(message_id);

create table blocked_senders (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  kind text not null,
  value text not null,
  created_at timestamptz not null default now()
);
create unique index blocked_senders_uq on blocked_senders(user_id, kind, value);

create table outbound_jobs (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  alias_id text references aliases(id) on delete set null,
  draft_id text,
  status outbound_status not null default 'queued',
  transport text not null,
  rcpt_to jsonb not null default '[]',
  rcpt_cc jsonb not null default '[]',
  rcpt_bcc jsonb not null default '[]',
  subject text not null default '',
  text_body text,
  html_body text,
  raw_key text,
  message_id_header text,
  in_reply_to text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbound_jobs_status_idx on outbound_jobs(status);

create table delivery_attempts (
  id text primary key,
  job_id text not null references outbound_jobs(id) on delete cascade,
  transport text not null,
  status text not null,
  response text,
  created_at timestamptz not null default now()
);
create index delivery_attempts_job_idx on delivery_attempts(job_id);

create table saved_views (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  query text not null
);
create index saved_views_user_idx on saved_views(user_id);

create table audit_log (
  id text primary key,
  user_id text references users(id) on delete set null,
  action text not null,
  meta jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index audit_log_user_idx on audit_log(user_id, created_at desc);
