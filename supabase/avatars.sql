-- Profile pictures.
--
-- profiles.avatar_path points to a file in the private "avatars" bucket.
-- File path: <my user id>/<random id>.jpg
-- Every upload gets a new random name, so friends never see a stale cached
-- picture, and the old file is deleted by the app after the switch.
--
-- Who can see a picture: the owner, plus anyone who shares a contacts row
-- with them (friends and pending requests, both ways) - same rule as emails.

-- 1. The column. It can only point inside the owner's own folder.
alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  drop constraint if exists avatar_path_own_folder;
alter table public.profiles
  add constraint avatar_path_own_folder check (
    avatar_path is null
    or avatar_path ~ ('^' || id::text || '/[a-z0-9-]{8,64}\.jpg$')
  );

-- 2. A private bucket: JPEG only, max 512 KB
--    (the app crops and shrinks to 512x512 before upload, usually ~60 KB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 524288, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = 524288,
      allowed_mime_types = array['image/jpeg'];

-- 3. Upload: only into my own folder (one level deep)
drop policy if exists "avatars: upload my own" on storage.objects;
create policy "avatars: upload my own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- 4. View: me, or anyone who shares a contacts row with the owner
drop policy if exists "avatars: me and my contacts" on storage.objects;
create policy "avatars: me and my contacts"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.contacts c
        where (c.requester_id = (select auth.uid())
                and c.addressee_id::text = (storage.foldername(name))[1])
           or (c.addressee_id = (select auth.uid())
                and c.requester_id::text = (storage.foldername(name))[1])
      )
    )
  );

-- 5. Delete: only my own files (removing / replacing my picture)
drop policy if exists "avatars: delete my own" on storage.objects;
create policy "avatars: delete my own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );