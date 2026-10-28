create table public.privacy_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 kind text not null check (kind in ('access','delete')),
 message text not null default '' check (char_length(message)<=1000),
 status text not null default '접수' check (status in ('접수','처리중','완료')),
 response text not null default '' check (char_length(response)<=2000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,request_id)
);
create index privacy_requests_created_idx on public.privacy_requests(created_at desc,id desc);
alter table public.privacy_requests enable row level security;
revoke all on public.privacy_requests from anon,authenticated;
grant select on public.privacy_requests to authenticated;
grant insert (user_id,request_id,kind,message) on public.privacy_requests to authenticated;
grant update (status,response,updated_at) on public.privacy_requests to authenticated;
grant all on public.privacy_requests to service_role;
create policy privacy_read on public.privacy_requests for select to authenticated
 using ((select auth.uid())=user_id or ((select auth.jwt())->'app_metadata'->>'role')='admin');
create policy privacy_create on public.privacy_requests for insert to authenticated
 with check ((select auth.uid())=user_id);
create policy privacy_admin_update on public.privacy_requests for update to authenticated
 using (((select auth.jwt())->'app_metadata'->>'role')='admin')
 with check (((select auth.jwt())->'app_metadata'->>'role')='admin');
