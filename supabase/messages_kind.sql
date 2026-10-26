-- Message kinds: 'msg' = a normal message (text, reply, buzz), 'react' = a reaction.
-- The server only learns that a reaction happened, never which message or which emoji
-- (that stays inside the encrypted text).

alter table public.messages
  add column if not exists kind text not null default 'msg';

alter table public.messages
  drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check check (kind in ('msg', 'react'));

-- Clients may choose the kind when sending (like the other insert columns)
grant insert (kind) on public.messages to authenticated;