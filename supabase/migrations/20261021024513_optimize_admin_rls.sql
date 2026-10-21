begin;
alter policy complaint_read on public.citizen_complaints using ((select auth.uid())=user_id or ((select auth.jwt())->'app_metadata'->>'role')='admin');
alter policy complaint_admin_update on public.citizen_complaints using (((select auth.jwt())->'app_metadata'->>'role')='admin') with check (((select auth.jwt())->'app_metadata'->>'role')='admin');
alter policy chat_admin_read on public.chat_session using (((select auth.jwt())->'app_metadata'->>'role')='admin');
alter policy ticket_owner_read on public.queue_tickets using ((select auth.uid())=user_id or ((select auth.jwt())->'app_metadata'->>'role')='admin');
commit;
