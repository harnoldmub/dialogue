import pg from 'pg';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const { Pool } = pg;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  : null;
const FALLBACK_FILE = 'data/contributions.json';

export function getDatabase(){ return pool; }

export async function ensureDatabase(){
  if (!pool) {
    console.warn(`DATABASE_URL absent : les contributions seront écrites dans ${FALLBACK_FILE} (non durable en production).`);
    return false;
  }
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const migrations = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
    for (const migration of migrations) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [migration]);
      if (!exists.rowCount) {
        await client.query(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [migration]);
        console.log(`Applied ${migration}`);
      }
    }
    return true;
  } finally {
    client.release();
  }
}

// Les écritures du fichier de secours sont sérialisées : deux envois simultanés ne doivent pas écraser la même liste.
let fallbackQueue = Promise.resolve();

async function saveToFile(input){
  await mkdir('data', { recursive: true });
  let items = [];
  try { items = JSON.parse(await readFile(FALLBACK_FILE, 'utf8')); } catch { items = []; }
  const reference = `DIALOGUE-${new Date().getFullYear()}-${String(items.length + 1).padStart(6, '0')}`;
  items.push({ ...input, reference, createdAt: new Date().toISOString() });
  await writeFile(FALLBACK_FILE, JSON.stringify(items, null, 2));
  return { id: input.id, reference };
}

export async function saveContribution(input){
  if (!pool) {
    const result = fallbackQueue.then(() => saveToFile(input));
    fallbackQueue = result.catch(() => {});
    return result;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const contribution = await client.query(
      `INSERT INTO contributions (id,first_name,last_name,email,phone,country,city,province,profile,theme,title,text_content,audio_key,audio_duration,audio_mime,audio_size,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'RECEIVED') RETURNING id,reference`,
      [input.id, input.firstName, input.lastName, input.email, input.phone || null, input.country, input.city, input.province || null,
       input.profile || null, input.theme, input.title || null, input.textContent || null, input.audioKey, input.audioDuration, input.audioMime || null, input.audioSize || null]
    );
    for (const file of input.files) {
      await client.query('INSERT INTO contribution_files (contribution_id,storage_key,original_name,mime_type,size) VALUES ($1,$2,$3,$4,$5)',
        [input.id, file.storageKey, file.originalName, file.mimeType, file.size]);
    }
    await client.query('COMMIT');
    return contribution.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
