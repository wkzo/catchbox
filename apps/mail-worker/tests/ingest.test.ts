import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@catchbox/config';
import { createDb, messages, aliases } from "@catchbox/db";
import { createStore } from '@catchbox/store';
import { eq, inArray } from 'drizzle-orm';
import { ingestMessage } from '../src/ingest.js';

const suffix = Math.floor(Math.random() * 1e6);
const alias = `itest-${suffix}`;
const domain = 'example.com';

let db: ReturnType<typeof createDb>;
let storeDir: string;

beforeAll(() => {
  process.env['STORE_DRIVER'] = 'fs';
  storeDir = mkdtempSync(path.join(tmpdir(), 'quit-store-'));
  process.env['STORE_FS_PATH'] = storeDir;
  process.env['DOMAIN'] = 'example.com';
  db = createDb(process.env['DATABASE_URL'] ?? 'postgres://quit:quit@127.0.0.1:5432/quit_mail');
});

afterAll(async () => {
  const rows = await db.select({ id: aliases.id }).from(aliases).where(eq(aliases.localpart, alias));
  if (rows.length) {
    const aliasIds = rows.map((r) => r.id);
    await db.delete(messages).where(inArray(messages.aliasId, aliasIds));
    await db.delete(aliases).where(inArray(aliases.id, aliasIds));
  }
  await db.close();
  rmSync(storeDir, { recursive: true, force: true });
});

function makeRaw(messageId: string, subject: string, extra = '') {
  return Buffer.from(
    `From: sender@example.com\r\nTo: ${alias}@${domain}\r\nSubject: ${subject}\r\nMessage-ID: <${messageId}>\r\n${extra}Date: Thu, 07 Aug 2026 09:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nbody ${messageId}\r\n`,
  );
}

describe('ingest pipeline (integration)', () => {
  const cfg = () => loadConfig();

  it('auto-creates a discovered alias via catch-all', async () => {
    const deps = { cfg: cfg(), db, store: createStore(cfg()) };
    const res = await ingestMessage(deps, { from: 'sender@example.com', to: [`${alias}@${domain}`] }, makeRaw('a1', 'Catch-all test'));
    expect(res.status).toBe('accepted');
    const [a] = await db.select().from(aliases).where(eq(aliases.localpart, alias)).limit(1);
    expect(a?.source).toBe('discovered');
  });

  it('dedupes identical deliveries (idempotency)', async () => {
    const deps = { cfg: cfg(), db, store: createStore(cfg()) };
    const raw = makeRaw('a2', 'Dup test');
    const first = await ingestMessage(deps, { from: 'sender@example.com', to: [`${alias}@${domain}`] }, raw);
    const second = await ingestMessage(deps, { from: 'sender@example.com', to: [`${alias}@${domain}`] }, raw);
    expect(first.status).toBe('accepted');
    expect(second.status).toBe('accepted');
    if (second.status !== 'accepted') throw new Error('unreachable');
    expect(second.duplicate).toBe(true);
    const count = await db.select().from(messages).where(eq(messages.messageIdHeader, '<a2>'));
    expect(count.length).toBe(1);
  });

  it('links a reply into the same thread via In-Reply-To', async () => {
    const deps = { cfg: cfg(), db, store: createStore(cfg()) };
    await ingestMessage(deps, { from: 'sender@example.com', to: [`${alias}@${domain}`] }, makeRaw('t1', 'Thread base'));
    const reply = makeRaw('t2', 'Re: Thread base', 'In-Reply-To: <t1>\r\nReferences: <t1>\r\n');
    await ingestMessage(deps, { from: 'sender@example.com', to: [`${alias}@${domain}`] }, reply);
    const [base] = await db.select().from(messages).where(eq(messages.messageIdHeader, '<t1>')).limit(1);
    const [rep] = await db.select().from(messages).where(eq(messages.messageIdHeader, '<t2>')).limit(1);
    expect(rep?.threadId).toBe(base?.threadId);
  });

  it('rejects mail for foreign domains (no open relay at pipeline level)', async () => {
    const deps = { cfg: cfg(), db, store: createStore(cfg()) };
    const res = await ingestMessage(deps, { from: 'x@y.z', to: ['someone@other.example'] }, Buffer.from('From: x@y.z\r\n\r\nhi'));
    expect(res.status).toBe('rejected');
  });
});
