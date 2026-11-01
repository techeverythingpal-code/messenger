-- Voice notes: encrypted audio files.
--
-- The audio is encrypted on the sender's device before upload, so this bucket
-- only ever holds unreadable data. The key for each file travels inside the
-- normal end-to-end encrypted message.
--
-- File path: <sender id>/<receiver id>/<random id>

-- 1. A private bucket: max 3 MB per file, any encrypted blob
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', false, 3145728, array['application/octet-stream'])
on conflict (id) do update
  set public = false,
      file_size_limit = 3145728,
      allowed_mime_types = array['application/octet-stream'];

-- 2. Upload: only into my own folder, and only for an accepted friend
drop policy if exists "voice: upload to a friend" on storage.objects;
create policy "voice: upload to a friend"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.contacts c
      where c.status = 'accepted'
        and (
          (c.requester_id = (select auth.uid())
            and c.addressee_id::text = (storage.foldername(name))[2])
          or
          (c.addressee_id = (select auth.uid())
            and c.requester_id::text = (storage.foldername(name))[2])
        )
    )
  );

-- 3. Download: only the sender and the receiver named in the path
drop policy if exists "voice: read my own chats" on storage.objects;
create policy "voice: read my own chats"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice'
    and (select auth.uid())::text in (
      (storage.foldername(name))[1],
      (storage.foldername(name))[2]
    )
  );

-- 4. Delete: only my own uploads (so a failed send can be cleaned up)
drop policy if exists "voice: delete my own uploads" on storage.objects;
create policy "voice: delete my own uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );