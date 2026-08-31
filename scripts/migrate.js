import pg from 'pg';
import { readFile } from 'node:fs/promises';
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required to run migrations.');process.exit(1)}
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined});
await client.connect();
try{await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');const name='001_contributions.sql';const exists=await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name]);if(!exists.rowCount){await client.query(await readFile(`migrations/${name}`,'utf8'));await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);console.log(`Applied ${name}`)}else console.log('Database is current')}finally{await client.end()}
