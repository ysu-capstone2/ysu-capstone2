// Preview by default; --apply runs every pending migration in one transaction.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { planBootstrap } from './database-bootstrap.mjs';

const db = new URL(process.env.POSTGRES_URL_NON_POOLING || 'postgres://invalid');
const project = new URL(process.env.SUPABASE_URL || 'https://invalid').hostname.split('.')[0];
const local = ['localhost', '127.0.0.1', '[::1]'].includes(db.hostname);
if ((!local && (!db.password || !decodeURIComponent(db.username).endsWith('.'+project))) || project === 'invalid') throw new Error('Database connection and SUPABASE_URL must belong to the same project.');
const psql = process.env.PSQL_BIN || 'psql';
const env = {...process.env, PGHOST:db.hostname, PGPORT:db.port||'5432', PGUSER:decodeURIComponent(db.username), PGPASSWORD:decodeURIComponent(db.password), PGDATABASE:db.pathname.slice(1), PGSSLMODE:local?'disable':'require', PGCONNECT_TIMEOUT:'10'};
function query(sql) {
  const result = spawnSync(psql, ['-X','-A','-t','-v','ON_ERROR_STOP=1','-f','-'], {env,input:sql,encoding:'utf8'});
  if (result.status !== 0) throw new Error('Database setup failed. Check schema compatibility and connection settings. No connection credentials were printed.');
  return result.stdout.trim();
}
const tables = JSON.parse(query("select coalesce(json_agg(table_name),'[]'::json) from information_schema.tables where table_schema='public';"));
const columns = JSON.parse(query("select coalesce(json_agg(column_name),'[]'::json) from information_schema.columns where table_schema='public' and table_name='citizen_complaints';"));
if (tables.includes('chat_session')) {
  const chatColumns = JSON.parse(query("select json_agg(column_name) from information_schema.columns where table_schema='public' and table_name='chat_session';"));
  for (const name of ['id','knowledge_id','citizen_id','query','answer','confidence_score','status','channel','created_at']) if (!chatColumns.includes(name)) throw new Error('Legacy chat schema is incompatible.');
}
const hasHistory = query("select to_regclass('supabase_migrations.schema_migrations') is not null;") === 't';
const applied = hasHistory ? JSON.parse(query("select coalesce(json_agg(version),'[]'::json) from supabase_migrations.schema_migrations;")) : [];
const hasCancel = query("select to_regprocedure('public.portal_cancel_ticket(uuid,uuid)') is not null;") === 't';
const directory = new URL('../supabase/migrations/', import.meta.url);
const migrations = [];
for (const file of (await readdir(directory)).filter(file => /^\d+_[a-z0-9_]+\.sql$/.test(file)).sort()) {
  const [,version,name] = file.match(/^(\d+)_(.+)\.sql$/);
  migrations.push({version,name,sql:await readFile(new URL(file,directory),'utf8')});
}
const sql = planBootstrap({migrations,tables,columns,hasCancel,applied});
await mkdir('.local', {recursive:true,mode:0o700});
await writeFile('.local/database-bootstrap.sql',sql,{mode:0o600});
if (process.argv.includes('--apply')) { query(sql); console.log('Pending migrations applied and recorded; existing records preserved.'); }
else console.log('Review .local/database-bootstrap.sql, then rerun with --apply. No schema changes made.');
