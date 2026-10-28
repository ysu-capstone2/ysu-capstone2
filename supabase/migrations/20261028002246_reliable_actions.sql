begin;
-- Small private receipts make lost-response retries safe across server instances.
-- Payloads are fingerprinted; contact details and supplement text are not copied here.
create table public.portal_action_receipts (
 request_id uuid primary key,
 actor_id uuid not null references auth.users(id) on delete cascade,
 scope text not null check (scope in ('complaint','call_next')),
 entity_id uuid not null,
 fingerprint text not null,
 response jsonb not null,
 created_at timestamptz not null default now()
);
create index portal_action_receipts_actor_idx on public.portal_action_receipts(actor_id);
create index portal_action_receipts_created_idx on public.portal_action_receipts(created_at);
alter table public.portal_action_receipts enable row level security;
revoke all on public.portal_action_receipts from public,anon,authenticated;
grant select,insert,delete on public.portal_action_receipts to service_role;

-- A monotonic revision also changes for mutations in the same transaction.
create function public.portal_counter_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 return new;
end $$;
revoke all on function public.portal_counter_revision() from public,anon,authenticated;
grant execute on function public.portal_counter_revision() to service_role;
create trigger portal_counter_revision before update on public.service_counters for each row execute function public.portal_counter_revision();

create function public.portal_member_complaint_once(p_id uuid,p_user uuid,p_action text,p_request uuid,p_text text default '',p_preferred timestamptz default null)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.portal_action_receipts; signature text; outcome jsonb;
begin
 if p_request is null then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 signature:=encode(sha256(convert_to(jsonb_build_array(p_action,trim(coalesce(p_text,'')),extract(epoch from p_preferred))::text,'UTF8')),'hex');
 delete from public.portal_action_receipts where created_at<now()-interval '30 days';
 select * into previous from public.portal_action_receipts where request_id=p_request;
 if found then
  if previous.actor_id<>p_user or previous.scope<>'complaint' or previous.entity_id<>p_id or previous.fingerprint<>signature then
   return jsonb_build_object('ok',false,'reason','request_conflict');
  end if;
  return previous.response || jsonb_build_object('replayed',true);
 end if;
 outcome:=public.portal_member_complaint(p_id,p_user,p_action,p_text,p_preferred);
 if coalesce((outcome->>'ok')::boolean,false) then
  insert into public.portal_action_receipts(request_id,actor_id,scope,entity_id,fingerprint,response)
   values(p_request,p_user,'complaint',p_id,signature,outcome);
 end if;
 return outcome;
end $$;

create function public.portal_call_next_once(p_counter uuid,p_actor uuid,p_request uuid,p_expected timestamptz)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.portal_action_receipts; c public.service_counters; signature text; ticket jsonb; outcome jsonb;
begin
 if p_request is null or p_expected is null then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 signature:=encode(sha256(convert_to(extract(epoch from p_expected)::text,'UTF8')),'hex');
 delete from public.portal_action_receipts where created_at<now()-interval '30 days';
 select * into previous from public.portal_action_receipts where request_id=p_request;
 if found then
  if previous.actor_id<>p_actor or previous.scope<>'call_next' or previous.entity_id<>p_counter or previous.fingerprint<>signature then
   return jsonb_build_object('ok',false,'reason','request_conflict');
  end if;
  return previous.response || jsonb_build_object('replayed',true);
 end if;
 select * into c from public.service_counters where id=p_counter for update;
 if not found or not c.is_open then return jsonb_build_object('ok',false,'reason','counter_closed'); end if;
 if c.updated_at is distinct from p_expected then return jsonb_build_object('ok',false,'reason','stale_counter'); end if;
 ticket:=public.portal_call_next(p_counter);
 outcome:=jsonb_build_object('ok',true,'callingNo',ticket->'ticket_no');
 insert into public.portal_action_receipts(request_id,actor_id,scope,entity_id,fingerprint,response)
  values(p_request,p_actor,'call_next',p_counter,signature,outcome);
 return outcome;
end $$;
revoke all on function public.portal_member_complaint_once(uuid,uuid,text,uuid,text,timestamptz),public.portal_call_next_once(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.portal_member_complaint_once(uuid,uuid,text,uuid,text,timestamptz),public.portal_call_next_once(uuid,uuid,uuid,timestamptz) to service_role;
create index citizen_complaints_status_created_idx on public.citizen_complaints(process_status,created_at desc,id desc);
commit;
