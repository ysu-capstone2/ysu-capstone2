-- Run against an isolated migrated test database only. All rows are rolled back.
begin;
insert into public.admin_knowledge(title,content,approval_status) values
 ('visibility approved','approved','승인완료'),
 ('visibility pending','pending','검토대기'),
 ('visibility rejected','rejected','반려');

set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 if (select count(*) from public.admin_knowledge where title like 'visibility %') <> 1 then
  raise exception 'Anonymous users must see only approved knowledge';
 end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","app_metadata":{}}',true);
do $$ begin
 if (select count(*) from public.admin_knowledge where title like 'visibility %') <> 1 then
  raise exception 'Members must see only approved knowledge';
 end if;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}',true);
do $$ begin
 if (select count(*) from public.admin_knowledge where title like 'visibility %') <> 3 then
  raise exception 'Administrators must see all knowledge';
 end if;
 update public.admin_knowledge set approval_status='승인완료' where title='visibility pending';
 if not found then raise exception 'Administrator could not approve draft'; end if;
end $$;
rollback;
