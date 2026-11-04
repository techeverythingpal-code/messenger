-- Emails of the people in my contacts (friends and pending requests, both ways).
-- Emails live in the private auth.users table, so this function runs with
-- owner rights but only ever returns people who share a contacts row with me.
create or replace function public.contact_emails()
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text
  from public.contacts c
  join auth.users u
    on u.id = case
                when c.requester_id = (select auth.uid()) then c.addressee_id
                else c.requester_id
              end
  where (select auth.uid()) in (c.requester_id, c.addressee_id);
$$;

-- Only signed-in users can call it
revoke all on function public.contact_emails() from public, anon;
grant execute on function public.contact_emails() to authenticated;