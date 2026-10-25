create table public.push_subscriptions (
  device_id uuid primary key,
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),

  -- the device must really belong to the user; removing the device removes this row
  foreign key (device_id, user_id)
    references public.devices (id, user_id) on delete cascade,

  constraint endpoint_check check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  constraint key_size check (char_length(p256dh) <= 200 and char_length(auth) <= 100)
);

alter table public.push_subscriptions enable row level security;

create policy "Read own subscription"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Add own subscription"
  on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Remove own subscription"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant insert (device_id, user_id, endpoint, p256dh, auth)
  on public.push_subscriptions to authenticated;