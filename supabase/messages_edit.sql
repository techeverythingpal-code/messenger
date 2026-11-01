-- Message kinds: 'msg' = a normal message (text, reply, buzz),
-- 'react' = a reaction, 'edit' = a change to one of my earlier messages.
-- The server only learns that an edit happened, never which message or the new
-- text (that stays inside the encrypted text).

alter table public.messages
  drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check check (kind in ('msg', 'react', 'edit'));