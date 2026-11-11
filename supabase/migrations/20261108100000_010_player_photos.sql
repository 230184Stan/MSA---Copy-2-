/*
# 010 — Player photos

## What
- player.photo_path: where the player's photo lives in storage (null = no photo).
- A PRIVATE storage bucket "player-photos". Nothing is reachable by a public link; the app
  shows photos through short-lived signed links.

## Who can see / change a photo
Same people who can already see the PLAYER: the storage rules look the player up through the
normal player row-level security, so "can see the player" = "can see the photo".
  - read:    admin, or the manager of a club the player is registered with (or who created them)
  - upload / replace / delete: admin or club manager, for players they can see
Photos can be of children, so there is no public access and no listing for anyone else.

## File rules (enforced by storage, not just the app)
- Path must be  <player id>/<number>.jpg  (a new number each upload, so a replaced photo is
  never served from a stale cache; the app deletes the old file).
- JPEG only, max 500 KB. The app shrinks photos to ~640px before upload (about 50-150 KB),
  which also suits slow mobile data.
*/

alter table public.player add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', false, 512000, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists player_photos_read   on storage.objects;
drop policy if exists player_photos_insert on storage.objects;
drop policy if exists player_photos_update on storage.objects;
drop policy if exists player_photos_delete on storage.objects;

create policy player_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'player-photos'
    and exists (select 1 from public.player p
                 where p.id::text = (storage.foldername(objects.name))[1])
  );

create policy player_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'player-photos'
    and public.my_role() in ('admin', 'club_manager')
    and exists (select 1 from public.player p
                 where objects.name ~ ('^' || p.id::text || '/[0-9]+\.jpg$'))
  );

create policy player_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'player-photos'
    and public.my_role() in ('admin', 'club_manager')
    and exists (select 1 from public.player p
                 where p.id::text = (storage.foldername(objects.name))[1])
  )
  with check (
    bucket_id = 'player-photos'
    and exists (select 1 from public.player p
                 where objects.name ~ ('^' || p.id::text || '/[0-9]+\.jpg$'))
  );

create policy player_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'player-photos'
    and public.my_role() in ('admin', 'club_manager')
    and exists (select 1 from public.player p
                 where p.id::text = (storage.foldername(objects.name))[1])
  );
