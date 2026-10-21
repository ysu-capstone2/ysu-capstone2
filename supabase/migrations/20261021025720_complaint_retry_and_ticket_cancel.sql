begin;
-- A browser reuses this key when retrying the same submission after a lost response.
alter table public.citizen_complaints add column request_id uuid not null default gen_random_uuid();
create unique index citizen_complaints_user_request_idx on public.citizen_complaints(user_id,request_id);
grant insert (request_id) on public.citizen_complaints to authenticated;

alter table public.queue_tickets drop constraint queue_tickets_status_check;
alter table public.queue_tickets add constraint queue_tickets_status_check check (status in ('대기','호출','완료','취소'));
create function public.portal_cancel_ticket(p_ticket uuid,p_user uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare counter uuid; t public.queue_tickets;
begin
 select counter_id into counter from public.queue_tickets where id=p_ticket and user_id=p_user;
 if not found then return jsonb_build_object('cancelled',false,'reason','not_found'); end if;
 -- Match join/call lock order: counter first, ticket second.
 perform 1 from public.service_counters where id=counter for update;
 select * into t from public.queue_tickets where id=p_ticket and user_id=p_user for update;
 if not found then return jsonb_build_object('cancelled',false,'reason','not_found'); end if;
 if t.status='취소' then return jsonb_build_object('cancelled',true); end if;
 if t.status<>'대기' then return jsonb_build_object('cancelled',false,'reason','already_called'); end if;
 update public.queue_tickets set status='취소' where id=p_ticket;
 update public.service_counters set waiting_count=greatest(waiting_count-1,0),updated_at=now() where id=counter;
 return jsonb_build_object('cancelled',true);
end $$;
revoke all on function public.portal_cancel_ticket(uuid,uuid) from public,anon,authenticated;
grant execute on function public.portal_cancel_ticket(uuid,uuid) to service_role;
commit;
