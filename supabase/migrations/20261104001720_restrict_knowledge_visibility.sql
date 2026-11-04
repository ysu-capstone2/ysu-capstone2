begin;

-- Unapproved drafts are visible only to administrators, including during edits.
drop policy if exists knowledge_public_read on public.admin_knowledge;
create policy knowledge_public_read on public.admin_knowledge for select to anon, authenticated
 using (approval_status = '승인완료' or ((select auth.jwt())->'app_metadata'->>'role') = 'admin');

commit;
