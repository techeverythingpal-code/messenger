create table public.messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  ciphertext text not null,   -- encrypted message (base64)
  iv text not null,           -- one-time random value for AES-GCM (base64)
  created_at timestamptz not null default now(),

  constraint no_self_message check (sender_id <> receiver_id),
  constraint iv_length check (char_length(iv) = 16),
  constraint ciphertext_size check (char_length(ciphertext) between 1 and 20000)
);

create index messages_receiver_idx on public.messages (receiver_id, created_at desc);
create index messages_sender_idx   on public.messages (sender_id, created_at desc);

alter table public.messages enable row level security;

-- You can read a message only if you sent it or it was sent to you
create policy "Read own messages"
  on public.messages for select to authenticated
  using ((select auth.uid()) in (sender_id, receiver_id));

-- You can send a message only as yourself
create policy "Send as yourself"
  on public.messages for insert to authenticated
  with check ((select auth.uid()) = sender_id);

-- No update or delete policies on purpose: messages can't be edited or deleted by clients.

-- Logged-out visitors get no access at all
revoke all on public.messages from anon;

-- Lets the app receive new messages in real time (Realtime respects the rules above)
alter publication supabase_realtime add table public.messages;