import { randomBytes } from 'node:crypto';
import readline from 'node:readline/promises';
import { hash } from '@node-rs/argon2';
import { nanoid } from 'nanoid';
import { loadConfig } from '@catchbox/config';
import { createDb, users, aliases } from '@catchbox/db';
import { count, eq } from 'drizzle-orm';

async function main() {
  const cfg = loadConfig();
  const db = createDb(cfg.DATABASE_URL);
  const countRows = await db.select({ n: count() }).from(users);
  if ((countRows[0]?.n ?? 0) > 0) {
    console.error('An owner already exists. Use the recovery flow to reset credentials.');
    await db.close();
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const email = (await rl.question('Owner login email: ')).trim().toLowerCase();
  let password = process.env['OWNER_PASSWORD'];
  if (!password) {
    password = await rl.question('Password (min 10 chars, input hidden if piped): ');
  }
  rl.close();
  if (!email.includes('@') || !password || password.length < 10) {
    console.error('Invalid email or password (min 10 chars).');
    process.exit(1);
  }
  const id = nanoid(16);
  await db.insert(users).values({
    id,
    email,
    passwordHash: await hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 }),
    recoveryKeyHash: null,
  });
  for (const lp of ['postmaster', 'abuse']) {
    await db.insert(aliases).values({
      id: nanoid(16),
      userId: id,
      localpart: lp,
      source: 'system',
    });
  }
  const recoveryKey = randomBytes(16).toString('base64url');
  const { createHash } = await import('node:crypto');
  await db
    .update(users)
    .set({ recoveryKeyHash: createHash('sha256').update(recoveryKey).digest('hex') })
    .where(eq(users.id, id));
  console.log(`\nOwner created: ${email}`);
  console.log(`Recovery key (store it safely, shown once):\n${recoveryKey}`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
