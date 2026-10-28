-- Isolated local test database only. All test rows are rolled back.
begin;
insert into auth.users(id) values ('70000000-0000-4000-8000-000000000001'),('70000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000001","user_metadata":{"role":"admin"},"app_metadata":{}}',true);
insert into public.privacy_requests(user_id,request_id,kind,message)
 values ('70000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','delete','내 상담 기록 삭제 요청');
do $$ begin
 if (select count(*) from public.privacy_requests)<>1 then raise exception 'Owner cannot read own privacy request'; end if;
 begin
  insert into public.privacy_requests(user_id,request_id,kind) values ('70000000-0000-4000-8000-000000000002',gen_random_uuid(),'access');
  raise exception 'Forged privacy owner accepted';
 exception when insufficient_privilege then null; end;
 update public.privacy_requests set status='완료',response='forged';
 if found then raise exception 'Member forged completion via user_metadata'; end if;
 begin
  update public.privacy_requests set user_id='70000000-0000-4000-8000-000000000002';
  raise exception 'Member can reassign privacy records';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.privacy_requests;
  raise exception 'Member deleted audit/request record';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000002","app_metadata":{}}',true);
do $$ begin
 if (select count(*) from public.privacy_requests)<>0 then raise exception 'Other account can read private request'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"70000000-0000-4000-8000-000000000002","app_metadata":{"role":"admin"}}',true);
do $$ begin
 if (select count(*) from public.privacy_requests)<>1 then raise exception 'Admin cannot review request'; end if;
 update public.privacy_requests set status='처리중',response='요청을 확인하고 있습니다.';
 if not found then raise exception 'Admin response not stored'; end if;
 begin
  update public.privacy_requests set message='tampered';
  raise exception 'Admin can rewrite original user request';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform * from public.privacy_requests;
  raise exception 'Anonymous privacy access allowed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
