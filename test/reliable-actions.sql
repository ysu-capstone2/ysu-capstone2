-- Isolated test DB only. Tests and fixtures roll back together.
begin;
insert into auth.users(id) values ('01000000-0000-4000-8000-000000000001'),('01000000-0000-4000-8000-000000000002');
insert into public.citizen_complaints(id,user_id,citizen_name,citizen_tel,dept_name,consult_type,summary,process_status)
 values ('11000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','재시도 회원','010-0000-0000','종합민원과','전화상담','재시도 검증','보완요청');
insert into public.service_counters(id,org_name,counter_name,location)
 values ('21000000-0000-4000-8000-000000000001','테스트 기관','테스트 창구','테스트 위치');
set local role authenticated;
do $$ begin
 if has_function_privilege(current_user,'public.portal_member_complaint_once(uuid,uuid,text,uuid,text,timestamptz)','execute') then raise exception 'Public mutation RPC exposed';end if;
 if has_function_privilege(current_user,'public.portal_call_next_once(uuid,uuid,uuid,timestamptz)','execute') then raise exception 'Public queue RPC exposed';end if;
 begin perform * from public.portal_action_receipts;raise exception 'Private receipts exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
do $$ declare result jsonb; revision timestamptz; after_call timestamptz;begin
 result:=public.portal_member_complaint_once('11000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','supplement','31000000-0000-4000-8000-000000000001','보완 설명');
 if result->>'ok'<>'true' then raise exception 'Initial supplement failed';end if;
 result:=public.portal_member_complaint_once('11000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','supplement','31000000-0000-4000-8000-000000000001','보완 설명');
 if result->>'replayed'<>'true' then raise exception 'Lost-response retry was not replayed';end if;
 if (select jsonb_array_length(supplements) from public.citizen_complaints where id='11000000-0000-4000-8000-000000000001')<>1 then raise exception 'Duplicate supplement';end if;
 result:=public.portal_member_complaint_once('11000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','supplement','31000000-0000-4000-8000-000000000001','변경한 설명');
 if result->>'reason'<>'request_conflict' then raise exception 'Changed retry payload accepted';end if;
 result:=public.portal_member_complaint_once('11000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000002','supplement','31000000-0000-4000-8000-000000000001','보완 설명');
 if result->>'ok'<>'false' then raise exception 'Cross-user retry accepted';end if;
 perform public.portal_join_queue('21000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001');
 perform public.portal_join_queue('21000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000002');
 select updated_at into revision from public.service_counters where id='21000000-0000-4000-8000-000000000001';
 result:=public.portal_call_next_once('21000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',revision);
 if result->>'ok'<>'true' or result->>'callingNo'<>'1' then raise exception 'First queue call failed';end if;
 select updated_at into after_call from public.service_counters where id='21000000-0000-4000-8000-000000000001';
 if after_call<=revision then raise exception 'Counter revision did not advance';end if;
 result:=public.portal_call_next_once('21000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',revision);
 if result->>'replayed'<>'true' or result->>'callingNo'<>'1' then raise exception 'Queue retry skipped a ticket';end if;
 if (select current_calling_no from public.service_counters where id='21000000-0000-4000-8000-000000000001')<>1 then raise exception 'Retry advanced queue';end if;
 result:=public.portal_call_next_once('21000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002',revision);
 if result->>'reason'<>'stale_counter' then raise exception 'Stale administrator call was accepted';end if;
 result:=public.portal_call_next_once('21000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002',after_call);
 if result->>'callingNo'<>'2' then raise exception 'Fresh next call failed';end if;
 if (select waiting_count from public.service_counters where id='21000000-0000-4000-8000-000000000001')<>0 then raise exception 'Waiting count mismatch';end if;
end $$;
rollback;
