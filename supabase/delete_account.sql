create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  recent_login boolean;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  -- Require a password login within the last 5 minutes
  select exists (
    select 1
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as a
    where a ->> 'method' = 'password'
      and (a ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 300
  ) into recent_login;

  if not recent_login then
    raise exception 'Please confirm your password again';
  end if;

  -- Cascades to profiles, contacts and messages
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;