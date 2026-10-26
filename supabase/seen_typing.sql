-- 1. Privacy switches (saved on your account, so all your devices follow them)
alter table public.profiles
  add column if not exists share_seen boolean not null default true,
  add column if not exists share_typing boolean not null default true;

grant update (share_seen, share_typing) on public.profiles to authenticated;

-- 2. Read marks: "I have read everything from this friend up to this time"
create table if not exists public.read_marks (
  reader_id uuid not null references auth.users (id) on delete cascade,
  peer_id   uuid not null references auth.users (id) on delete cascade,
  read_until timestamptz not null,
  primary key (reader_id, peer_id),
  constraint no_self_mark check (reader_id <> peer_id)
);

alter table public.read_marks enable row level security;

drop policy if exists "Read marks involving me" on public.read_marks;
create policy "Read marks involving me"
  on public.read_marks for select to authenticated
  using ((select auth.uid()) in (reader_id, peer_id));

-- Clients can only read marks. Writing goes through the function below.
revoke all on public.read_marks from anon, authenticated;
grant select on public.read_marks to authenticated;

create or replace function public.mark_read(p_peer uuid, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  -- Respect my own privacy switch on the server too
  if not exists (select 1 from public.profiles where id = me and share_seen) then
    return;
  end if;

  if not exists (
    select 1 from public.contacts c
    where c.status = 'accepted'
      and ((c.requester_id = me and c.addressee_id = p_peer)
        or (c.requester_id = p_peer and c.addressee_id = me))
  ) then
    raise exception 'Not friends';
  end if;

  -- Never in the future, and never moves backwards
  insert into public.read_marks as r (reader_id, peer_id, read_until)
  values (me, p_peer, least(p_until, now()))
  on conflict (reader_id, peer_id)
  do update set read_until = greatest(r.read_until, excluded.read_until);
end;
$$;

revoke all on function public.mark_read(uuid, timestamptz) from public, anon;
grant execute on function public.mark_read(uuid, timestamptz) to authenticated;

-- Live updates, so ticks turn blue without a refresh
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'read_marks'
  ) then
    alter publication supabase_realtime add table public.read_marks;
  end if;
end $$;

-- 3. Typing: a private live channel only the two friends can join
create or replace function public.typing_topic_ok(t text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  a uuid;
  b uuid;
begin
  if me is null or t is null
     or t !~ '^typing:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    return false;
  end if;

  a := split_part(t, ':', 2)::uuid;
  b := split_part(t, ':', 3)::uuid;

  if me <> a and me <> b then
    return false;
  end if;

  return exists (
    select 1 from public.contacts c
    where c.status = 'accepted'
      and ((c.requester_id = a and c.addressee_id = b)
        or (c.requester_id = b and c.addressee_id = a))
  );
end;
$$;

revoke all on function public.typing_topic_ok(text) from public, anon;
grant execute on function public.typing_topic_ok(text) to authenticated;

drop policy if exists "Typing: friends can listen" on realtime.messages;
create policy "Typing: friends can listen"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.typing_topic_ok((select realtime.topic()))
  );

drop policy if exists "Typing: friends can send" on realtime.messages;
create policy "Typing: friends can send"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.typing_topic_ok((select realtime.topic()))
  );