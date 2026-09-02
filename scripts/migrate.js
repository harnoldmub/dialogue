import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL est requis pour appliquer les migrations.'); process.exit(1); }

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});
await client.connect();
try {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const migrations = (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort();
  let applied = 0;
  for (const migration of migrations) {
    const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [migration]);
    if (exists.rowCount) continue;
    await client.query(await readFile(`migrations/${migration}`, 'utf8'));
    await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [migration]);
    console.log(`Appliquée : ${migration}`);
    applied++;
  }
  console.log(applied ? `${applied} migration(s) appliquée(s).` : 'Base à jour.');
} finally {
  await client.end();
}
