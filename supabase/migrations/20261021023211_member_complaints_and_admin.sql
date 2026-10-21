begin;
create table public.citizen_complaints (
 id uuid primary key default gen_random_uuid(),
 complaint_no text not null unique default ('YSU-' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD') || '-' || upper(replace(gen_random_uuid()::text, '-', ''))),
 user_id uuid not null references auth.users(id) on delete cascade,
 citizen_name text not null check (char_length(citizen_name) between 1 and 50),
 citizen_tel text not null check (char_length(citizen_tel) between 8 and 30),
 dept_name text not null,
 consult_type text not null check (consult_type in ('전화상담','방문상담','채팅상담')),
 summary text not null check (char_length(summary) between 1 and 2000),
 process_status text not null default '접수' check (process_status in ('접수','처리중','완료','보완요청')),
 officer_name text not null default '',
 due_date date,
 result text not null default '접수되었습니다. 담당자 확인을 기다리고 있어요.',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index citizen_complaints_user_created_idx on public.citizen_complaints(user_id,created_at desc);
alter table public.citizen_complaints enable row level security;
revoke all on public.citizen_complaints from anon, authenticated;
grant select on public.citizen_complaints to authenticated;
grant insert (user_id,citizen_name,citizen_tel,dept_name,consult_type,summary) on public.citizen_complaints to authenticated;
grant update (process_status,officer_name,result,updated_at) on public.citizen_complaints to authenticated;
create policy complaint_read on public.citizen_complaints for select to authenticated using ((select auth.uid())=user_id or (select auth.jwt()->'app_metadata'->>'role')='admin');
create policy complaint_create on public.citizen_complaints for insert to authenticated with check ((select auth.uid())=user_id);
create policy complaint_admin_update on public.citizen_complaints for update to authenticated using ((select auth.jwt()->'app_metadata'->>'role')='admin') with check ((select auth.jwt()->'app_metadata'->>'role')='admin');

create table public.chat_session (
 id bigint generated always as identity primary key,
 knowledge_id bigint,
 citizen_id text,
 channel text not null default 'WEB',
 query text not null,
 answer text not null,
 confidence_score numeric,
 status text not null,
 created_at timestamptz not null default now()
);
alter table public.chat_session enable row level security;
revoke all on public.chat_session from anon, authenticated;
grant select on public.chat_session to authenticated;
create policy chat_admin_read on public.chat_session for select to authenticated using ((select auth.jwt()->'app_metadata'->>'role')='admin');

create table public.service_counters (
 id uuid primary key default gen_random_uuid(),
 org_name text not null check (char_length(org_name) between 1 and 80),
 counter_name text not null check (char_length(counter_name) between 1 and 80),
 location text not null check (char_length(location) between 1 and 100),
 is_open boolean not null default true,
 last_issued integer not null default 0 check (last_issued>=0),
 current_calling_no integer,
 waiting_count integer not null default 0 check (waiting_count>=0),
 updated_at timestamptz not null default now()
);
alter table public.service_counters enable row level security;
revoke all on public.service_counters from anon, authenticated;
grant select on public.service_counters to anon, authenticated;
create policy counter_public_read on public.service_counters for select to anon, authenticated using (true);

create table public.queue_tickets (
 id uuid primary key default gen_random_uuid(),
 counter_id uuid not null references public.service_counters(id),
 user_id uuid not null references auth.users(id) on delete cascade,
 ticket_no integer not null,
 status text not null default '대기' check (status in ('대기','호출','완료')),
 created_at timestamptz not null default now(),
 called_at timestamptz,
 unique(counter_id,ticket_no)
);
create unique index one_waiting_ticket_per_user_counter on public.queue_tickets(counter_id,user_id) where status in ('대기','호출');
create index queue_tickets_user_idx on public.queue_tickets(user_id);
alter table public.queue_tickets enable row level security;
revoke all on public.queue_tickets from anon, authenticated;
grant select on public.queue_tickets to authenticated;
create policy ticket_owner_read on public.queue_tickets for select to authenticated using ((select auth.uid())=user_id or (select auth.jwt()->'app_metadata'->>'role')='admin');

-- Atomic queue mutations are called only by the authenticated server after checking the user/administrator.
-- SECURITY INVOKER retains the caller's privileges; these RPCs are not callable with public/user keys.
create function public.portal_join_queue(p_counter uuid,p_user uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.service_counters; t public.queue_tickets;
begin
 select * into c from public.service_counters where id=p_counter for update;
 if not found or not c.is_open then raise exception 'COUNTER_CLOSED'; end if;
 select * into t from public.queue_tickets where counter_id=p_counter and user_id=p_user and status in ('대기','호출');
 if found then return to_jsonb(t); end if;
 update public.service_counters set last_issued=last_issued+1,waiting_count=waiting_count+1,updated_at=now() where id=p_counter returning * into c;
 insert into public.queue_tickets(counter_id,user_id,ticket_no) values(p_counter,p_user,c.last_issued) returning * into t;
 return to_jsonb(t);
end $$;
create function public.portal_call_next(p_counter uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.service_counters; t public.queue_tickets;
begin
 select * into c from public.service_counters where id=p_counter for update;
 if not found or not c.is_open then raise exception 'COUNTER_CLOSED'; end if;
 update public.queue_tickets set status='완료' where counter_id=p_counter and status='호출';
 select * into t from public.queue_tickets where counter_id=p_counter and status='대기' order by ticket_no limit 1 for update;
 if not found then
  update public.service_counters set current_calling_no=null,waiting_count=0,updated_at=now() where id=p_counter;
  return null;
 end if;
 update public.queue_tickets set status='호출',called_at=now() where id=t.id returning * into t;
 update public.service_counters set current_calling_no=t.ticket_no,waiting_count=greatest(waiting_count-1,0),updated_at=now() where id=p_counter;
 return to_jsonb(t);
end $$;
revoke all on function public.portal_join_queue(uuid,uuid),public.portal_call_next(uuid) from public,anon,authenticated;
grant execute on function public.portal_join_queue(uuid,uuid),public.portal_call_next(uuid) to service_role;

create function public.portal_summary() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if coalesce((select auth.jwt()->'app_metadata'->>'role'),'') <> 'admin' then raise insufficient_privilege; end if;
 return jsonb_build_object(
  'totalComplaints',(select count(*) from public.citizen_complaints),
  'pending',(select count(*) from public.citizen_complaints where process_status='접수'),
  'processing',(select count(*) from public.citizen_complaints where process_status in ('처리중','보완요청')),
  'completed',(select count(*) from public.citizen_complaints where process_status='완료'),
  'totalInquiries',(select count(*) from public.chat_session),
  'waiting',(select coalesce(sum(waiting_count),0) from public.service_counters));
end $$;
revoke all on function public.portal_summary() from public,anon;
grant execute on function public.portal_summary() to authenticated;
grant all on public.citizen_complaints,public.chat_session,public.service_counters,public.queue_tickets to service_role;
grant usage,select on sequence public.chat_session_id_seq to service_role;
commit;
