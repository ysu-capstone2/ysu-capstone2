// Pure planner: usable by tests without a database or credentials.
export function planBootstrap({ migrations, tables, columns = [], hasCancel = false, applied = [] }) {
  const required = ['citizen_complaints', 'service_counters', 'queue_tickets'];
  const present = required.filter(table => tables.includes(table));
  if (present.length && present.length !== required.length) throw new Error('Partial member schema found; manual migration review required.');
  const existing = present.length === required.length;
  if (existing && !tables.includes('chat_session')) throw new Error('Partial member schema: chat_session is missing.');
  if (existing && columns.includes('request_id') !== hasCancel) throw new Error('Partial retry/cancellation schema found; manual migration review required.');
  const parts = ['begin;', 'create schema if not exists supabase_migrations;', 'create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);'];
  for (const { version, name, sql } of migrations) {
    if (applied.includes(version)) continue;
    const adopted = existing && (name === 'member_complaints_and_admin' || (name === 'complaint_retry_and_ticket_cancel' && hasCancel));
    if (!adopted) {
      let text = sql.replace(/^\s*begin;\s*/i, '').replace(/commit;\s*$/i, '');
      if (!existing && tables.includes('chat_session') && name === 'member_complaints_and_admin') {
        text = text.replace('create table public.chat_session (', 'create table if not exists public.chat_session (');
        text = text.replace('grant usage,select on sequence public.chat_session_id_seq to service_role;', () => "do $$ declare seq text; begin seq:=pg_get_serial_sequence('public.chat_session','id'); if seq is not null then execute format('grant usage,select on sequence %s to service_role',seq); end if; end $$;");
      }
      parts.push(text);
    }
    parts.push(`insert into supabase_migrations.schema_migrations(version,name) values('${version}','${name}') on conflict(version) do nothing;`);
  }
  for (const table of ['chat_session','complaint_ledger','transfer_reservation','notification_log'].filter(table => tables.includes(table))) {
    parts.push(`alter table public.${table} enable row level security;
revoke all on public.${table} from anon, authenticated;
grant select on public.${table} to authenticated;
drop policy if exists portal_private_admin_guard on public.${table};
create policy portal_private_admin_guard on public.${table} as restrictive for all to authenticated using (((select auth.jwt())->'app_metadata'->>'role')='admin') with check (((select auth.jwt())->'app_metadata'->>'role')='admin');`);
  }
  parts.push('commit;');
  return parts.join('\n');
}
