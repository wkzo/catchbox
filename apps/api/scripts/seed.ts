/** Development-only seed: demo owner + sample aliases. Never run in production. */
import { hash } from '@node-rs/argon2';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { loadConfig } from '@catchbox/config';
import { createDb, users, aliases } from '@catchbox/db';

async function main() {
  const cfg = loadConfig();
  if (cfg.NODE_ENV === 'production') {
    console.error('Refusing to seed in production');
    process.exit(1);
  }
  const db = createDb(cfg.DATABASE_URL);
  const passwordHash = await hash('CHANGE_ME_dev_only', { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const ownerId = nanoid(16);
  await db
    .insert(users)
    .values({ id: ownerId, email: 'owner@example.com', passwordHash })
    .onConflictDoNothing();
  const [owner] = await db.select().from(users).where(eq(users.email, 'owner@example.com')).limit(1);
  for (const lp of ['postmaster', 'abuse', 'hello']) {
    await db
      .insert(aliases)
      .values({ id: nanoid(16), userId: owner!.id, localpart: lp, source: lp === 'hello' ? 'manual' : 'system' })
      .onConflictDoNothing();
  }
  console.log('Seeded dev owner owner@example.com / CHANGE_ME_dev_only');
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
