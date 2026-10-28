-- Run against an isolated migrated test database only. All rows are rolled back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into public.citizen_complaints(id,user_id,citizen_name,citizen_tel,dept_name,consult_type,summary,process_status)
 values ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','회원1','010-1234-5678','종합민원과','전화상담','보완 대상','보완요청'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','회원2','010-1234-5678','종합민원과','방문상담','다른 회원 접수','접수');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","app_metadata":{}}',true);
do $$ begin
 if (select count(*) from public.citizen_complaints)<>1 then raise exception 'RLS owner isolation failed'; end if;
 if has_function_privilege(current_user,'public.portal_member_complaint(uuid,uuid,text,text,timestamptz)','execute') then raise exception 'Member can call privileged mutation RPC'; end if;
 begin
  update public.citizen_complaints set process_status='완료';
  if found then raise exception 'Member changed processing status'; end if;
 exception when insufficient_privilege then null; end;
 begin
  update public.citizen_complaints set supplements='[{"text":"forged"}]';
  raise exception 'Member forged supplement history';
 exception when insufficient_privilege then null; end;
end $$;
-- Column permissions allow a preferred date on a new owner-scoped receipt.
insert into public.citizen_complaints(user_id,citizen_name,citizen_tel,dept_name,consult_type,summary,request_id,preferred_at)
 values ('00000000-0000-4000-8000-000000000001','회원1','010-1234-5678','종합민원과','방문상담','희망일 접수','20000000-0000-4000-8000-000000000001',now()+interval '2 days');

reset role;
set local role service_role;
do $$ declare result jsonb; begin
 result:=public.portal_member_complaint('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','cancel');
 if result->>'reason'<>'not_found' then raise exception 'Cross-account mutation allowed'; end if;
 result:=public.portal_member_complaint('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','supplement','추가한 보완 설명');
 if result->>'ok'<>'true' then raise exception 'Supplement failed'; end if;
 if not exists(select 1 from public.citizen_complaints where id='10000000-0000-4000-8000-000000000001' and process_status='처리중' and supplements->0->>'text'='추가한 보완 설명') then raise exception 'Supplement/state not saved atomically'; end if;
 result:=public.portal_member_complaint('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','supplement','중복 설명');
 if result->>'ok'<>'false' then raise exception 'Invalid resubmission accepted'; end if;
 result:=public.portal_member_complaint('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','cancel');
 if result->>'ok'<>'false' then raise exception 'Processing receipt cancelled'; end if;
 result:=public.portal_member_complaint('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','reschedule','',now()-interval '1 day');
 if result->>'ok'<>'false' then raise exception 'Past schedule accepted'; end if;
 result:=public.portal_member_complaint('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','reschedule','',now()+interval '2 days');
 if result->>'ok'<>'true' then raise exception 'Reschedule failed'; end if;
 result:=public.portal_member_complaint('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','cancel');
 if result->>'ok'<>'true' then raise exception 'Cancellation failed'; end if;
 result:=public.portal_member_complaint('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','cancel');
 if result->>'ok'<>'true' then raise exception 'Cancellation replay not idempotent'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}',true);
do $$ begin
 if (public.portal_summary()->>'cancelled')::integer<>1 then raise exception 'Cancelled summary mismatch'; end if;
 update public.citizen_complaints set process_status='완료' where id='10000000-0000-4000-8000-000000000002' and process_status<>'취소';
 if found then raise exception 'Stale administrator update resurrected cancellation'; end if;
end $$;
rollback;
