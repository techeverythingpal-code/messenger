-- 1. Replace the policy that caused the recursion
drop policy "Add own device (max 10)" on public.devices;

create policy "Add own device"
  on public.devices for insert to authenticated
  with check (user_id = (select auth.uid()));

-- 2. Enforce the 10-device limit with a trigger instead
create or replace function public.limit_devices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.devices where user_id = new.user_id) >= 10 then
    raise exception 'Device limit reached (10)' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger devices_limit
  before insert on public.devices
  for each row execute function public.limit_devices();