-- 0. Old test messages use the old single-key format. Start clean.
drop table public.messages;

-- 1. Create a profile row automatically for every new account
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id) select id from auth.users on conflict do nothing;

-- 2. Devices: one public key per device
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  public_key jsonb not null,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  constraint devices_id_user_key unique (id, user_id),
  constraint device_name_len check (char_length(name) between 1 and 40),
  constraint device_key_shape
    check (public_key->>'kty' = 'EC' and public_key->>'crv' = 'P-256')
);

create index devices_user_idx on public.devices (user_id);

alter table public.devices enable row level security;

-- You see your own devices and your accepted friends' devices (needed to encrypt for them)
create policy "Read own and friends devices"
  on public.devices for select to authenticated
  using (
    devices.user_id = (select auth.uid())
    or exists (
      select 1 from public.contacts c
      where c.status = 'accepted'
        and ((c.requester_id = (select auth.uid()) and c.addressee_id = devices.user_id)
          or (c.addressee_id = (select auth.uid()) and c.requester_id = devices.user_id))
    )
  );

-- You can add devices only for yourself, up to 10
create policy "Add own device (max 10)"
  on public.devices for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select count(*) from public.devices d where d.user_id = (select auth.uid())) < 10
  );

create policy "Update own device"
  on public.devices for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Remove own device"
  on public.devices for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.devices from anon, authenticated;
grant select, delete on public.devices to authenticated;
grant insert (user_id, name, public_key) on public.devices to authenticated;
grant update (last_seen) on public.devices to authenticated;

-- 3. Messages: one row = one encrypted copy for one device
create table public.messages (
  id bigint generated always as identity primary key,
  msg_id uuid not null,            -- the same for every copy of one message
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  sender_device uuid not null,
  target_device uuid not null,     -- the device this copy is encrypted for
  target_user uuid not null,       -- the owner of that device
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now(),

  constraint no_self_message check (sender_id <> receiver_id),
  constraint target_is_participant check (target_user in (sender_id, receiver_id)),
  constraint iv_length check (char_length(iv) = 16),
  constraint ciphertext_size check (char_length(ciphertext) between 1 and 20000),

  -- the devices must really belong to those users
  foreign key (sender_device, sender_id) references public.devices (id, user_id) on delete cascade,
  foreign key (target_device, target_user) references public.devices (id, user_id) on delete cascade,
  unique (msg_id, target_device)
);

create index messages_target_idx on public.messages (target_device, created_at desc);
create index messages_pair_idx on public.messages (sender_id, receiver_id, created_at);

alter table public.messages enable row level security;

-- You can read only the copies made for your own devices
create policy "Read copies addressed to me"
  on public.messages for select to authenticated
  using (target_user = (select auth.uid()));

-- You can send only as yourself, and only between accepted friends
create policy "Send to accepted friends"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.contacts c
      where c.status = 'accepted'
        and ((c.requester_id = sender_id and c.addressee_id = receiver_id)
          or (c.requester_id = receiver_id and c.addressee_id = sender_id))
    )
  );

-- Clients can't choose id or created_at (so nobody can fake timestamps)
revoke all on public.messages from anon;
revoke insert on public.messages from authenticated;
grant insert (msg_id, sender_id, receiver_id, sender_device, target_device,
              target_user, ciphertext, iv)
  on public.messages to authenticated;

alter publication supabase_realtime add table public.messages;