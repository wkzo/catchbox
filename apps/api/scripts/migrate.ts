import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/db/migrations');

async function main() {
  const url = process.env['DATABASE_URL'] ?? 'postgres://quit:quit@127.0.0.1:5432/quit_mail';
  const sql = postgres(url, { max: 1 });
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await sql`select name from schema_migrations`).map((r) => r['name'] as string),
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(path.join(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
  await sql.end({ timeout: 5 });
  console.log('migrations up to date');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
