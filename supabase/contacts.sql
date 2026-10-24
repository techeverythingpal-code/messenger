create table public.contacts (
  id bigint generated always as identity primary key,
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  constraint no_self_contact check (requester_id <> addressee_id)
);

-- One relationship per pair of users, in either direction
create unique index contacts_pair_idx
  on public.contacts (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

alter table public.contacts enable row level security;

-- See only your own requests and friendships
create policy "Read own contacts"
  on public.contacts for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- Send a request only as yourself, and only as "pending"
create policy "Send requests as yourself"
  on public.contacts for insert to authenticated
  with check ((select auth.uid()) = requester_id and status = 'pending');

-- Only the person who RECEIVED the request can accept it
create policy "Addressee accepts"
  on public.contacts for update to authenticated
  using ((select auth.uid()) = addressee_id)
  with check ((select auth.uid()) = addressee_id and status = 'accepted');

-- Either person can cancel, decline, or remove
create policy "Either side can delete"
  on public.contacts for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- Column-level permissions: clients can only ever change "status", nothing else
revoke all on public.contacts from anon, authenticated;
grant select, insert, delete on public.contacts to authenticated;
grant update (status) on public.contacts to authenticated;

-- Live updates for new requests
alter publication supabase_realtime add table public.contacts;

-- Messages: only between accepted friends
drop policy "Send as yourself" on public.messages;

create policy "Send to accepted friends"
  on public.messages for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and exists (
      select 1 from public.contacts c
      where c.status = 'accepted'
        and ((c.requester_id = sender_id and c.addressee_id = receiver_id)
          or (c.requester_id = receiver_id and c.addressee_id = sender_id))
    )
  );