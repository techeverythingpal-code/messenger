-- 1. The setting (null = off). Only these values are allowed.
alter table public.contacts
  add column disappear_after_seconds integer
  check (disappear_after_seconds is null
         or disappear_after_seconds in (3600, 86400, 604800));

-- 2. Clients can't set it when sending a friend request
revoke insert on public.contacts from authenticated;
grant insert (requester_id, addressee_id) on public.contacts to authenticated;

-- 3. Changing it: only for an accepted friendship you belong to
create or replace function public.set_disappearing(p_contact_id bigint, p_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_seconds is not null and p_seconds not in (3600, 86400, 604800) then
    raise exception 'Invalid time';
  end if;

  update public.contacts
     set disappear_after_seconds = p_seconds
   where id = p_contact_id
     and status = 'accepted'
     and (select auth.uid()) in (requester_id, addressee_id);

  if not found then
    raise exception 'Contact not found';
  end if;
end;
$$;

revoke all on function public.set_disappearing(bigint, integer) from public, anon;
grant execute on function public.set_disappearing(bigint, integer) to authenticated;

-- 4. The cleaner: deletes messages older than their chat's setting
create or replace function public.purge_expired_messages()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.messages m
  using public.contacts c
  where c.status = 'accepted'
    and c.disappear_after_seconds is not null
    and ((m.sender_id = c.requester_id and m.receiver_id = c.addressee_id)
      or (m.sender_id = c.addressee_id and m.receiver_id = c.requester_id))
    and m.created_at < now() - make_interval(secs => c.disappear_after_seconds);
$$;

-- Nobody can call the cleaner from the app; only the scheduler runs it
revoke all on function public.purge_expired_messages() from public, anon, authenticated;

-- 5. Schedule it every 5 minutes
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-expired-messages',
  '*/5 * * * *',
  $$ select public.purge_expired_messages() $$
);