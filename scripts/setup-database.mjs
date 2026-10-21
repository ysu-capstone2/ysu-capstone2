// Prepare the member schema on a project that may already have the legacy chat table.
// Preview: node --env-file=.env.local scripts/setup-database.mjs
// Apply:   node --env-file=.env.local scripts/setup-database.mjs --apply
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const db = new URL(process.env.POSTGRES_URL_NON_POOLING || 'postgres://invalid');
const project = new URL(process.env.SUPABASE_URL || 'https://invalid').hostname.split('.')[0];
if (!db.password || !decodeURIComponent(db.username).endsWith('.'+project)) throw new Error('Database connection and SUPABASE_URL must belong to the same project.');
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/postgresql@15/bin/psql';
const env = {...process.env, PGHOST:db.hostname, PGPORT:db.port||'5432', PGUSER:decodeURIComponent(db.username), PGPASSWORD:decodeURIComponent(db.password), PGDATABASE:db.pathname.slice(1), PGSSLMODE:'require', PGCONNECT_TIMEOUT:'10'};
function query(sql) {
 const r=spawnSync(psql,['-X','-A','-t','-v','ON_ERROR_STOP=1','-f','-'],{env,input:sql,encoding:'utf8'});
 if(r.status!==0)throw new Error('Database setup failed. No connection credentials were printed.');
 return r.stdout.trim();
}
const tables=JSON.parse(query("select coalesce(json_agg(table_name),'[]'::json) from information_schema.tables where table_schema='public';"));
const required=['citizen_complaints','service_counters','queue_tickets'];
const present=required.filter(t=>tables.includes(t));
if(present.length && present.length!==required.length)throw new Error('Partial member schema found; manual migration review required.');
if(present.length===required.length){console.log('Member schema already exists; no baseline changes made.');process.exit(0);}
let baseline=await readFile(new URL('../supabase/migrations/20261021023211_member_complaints_and_admin.sql',import.meta.url),'utf8');
if(tables.includes('chat_session')){
 const cols=JSON.parse(query("select json_agg(column_name) from information_schema.columns where table_schema='public' and table_name='chat_session';"));
 for(const c of ['id','knowledge_id','citizen_id','query','answer','confidence_score','status','channel','created_at'])if(!cols.includes(c))throw new Error('Legacy chat schema is incompatible.');
 baseline=baseline.replace('create table public.chat_session (','create table if not exists public.chat_session (');
}
const optimize=await readFile(new URL('../supabase/migrations/20261021024513_optimize_admin_rls.sql',import.meta.url),'utf8');
// Existing permissive policies must not expose private chat or legacy receipt rows.
const privateTables=['chat_session','complaint_ledger','transfer_reservation','notification_log'].filter(t=>tables.includes(t));
const guards=privateTables.map(t=>`alter table public.${t} enable row level security;\nrevoke all on public.${t} from anon, authenticated;\ngrant select on public.${t} to authenticated;\ncreate policy portal_private_admin_guard on public.${t} as restrictive for all to authenticated using (((select auth.jwt())->'app_metadata'->>'role')='admin') with check (((select auth.jwt())->'app_metadata'->>'role')='admin');`).join('\n');
const sql='begin;\n'+baseline.replace(/^begin;\s*/,'').replace(/commit;\s*$/,'')+'\n'+optimize.replace(/^begin;\s*/,'').replace(/commit;\s*$/,'')+'\n'+guards+'\ncommit;\n';
await mkdir('.local',{recursive:true,mode:0o700});
await writeFile('.local/database-bootstrap.sql',sql,{mode:0o600});
if(process.argv.includes('--apply')){query(sql);console.log('Member schema applied; existing records preserved and private legacy records restricted.');}
else console.log('Review .local/database-bootstrap.sql, then rerun with --apply. No schema changes made.');
