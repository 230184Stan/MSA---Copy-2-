/*
# 022 — Club logos and announcements

## Club logos
- club.logo_path: where the club's logo file is stored.
- A PUBLIC storage bucket "club-logos" (logos appear on the public standings and fixtures pages,
  so they need no sign-in). Only PNG, JPEG or WebP, up to 256 KB each.
- Only an ADMINISTRATOR can add, replace or delete a logo. Each club's files live in a folder
  named after the club id, and the file name must be digits plus .png / .jpg / .webp.

## Announcements
announcement: a notice shown on the home page (and the dashboard for signed-in people).
  audience  'public' = everyone, even signed out;  'staff' = signed-in administrators, club
            managers and referees only
  pinned    pinned notices are listed first
  publish_at / expires_at  optional schedule; before publish_at and after expires_at it is hidden
Only ADMINISTRATORS can create, edit or delete announcements. People can only read the ones that
are live and meant for them (the database enforces this, not just the screen).

Safe to run more than once.
*/

-- ---------- club logos ----------
alter table public.club add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-logos', 'club-logos', true, 262144, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists club_logos_read on storage.objects;
drop policy if exists club_logos_insert on storage.objects;
drop policy if exists club_logos_update on storage.objects;
drop policy if exists club_logos_delete on storage.objects;

-- Logos are public. (Deleting or replacing a file also needs permission to see it.)
create policy club_logos_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'club-logos');

create policy club_logos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'club-logos'
    and public.is_admin()
    and exists (select 1 from public.club c
                 where objects.name ~ ('^' || c.id::text || '/[0-9]+\.(png|jpg|webp)$'))
  );

create policy club_logos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'club-logos' and public.is_admin())
  with check (
    bucket_id = 'club-logos'
    and public.is_admin()
    and exists (select 1 from public.club c
                 where objects.name ~ ('^' || c.id::text || '/[0-9]+\.(png|jpg|webp)$'))
  );

create policy club_logos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'club-logos' and public.is_admin());

-- ---------- announcements ----------
create table if not exists public.announcement (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) between 1 and 120),
  body       text not null check (length(btrim(body)) between 1 and 4000),
  audience   text not null default 'public' check (audience in ('public','staff')),
  pinned     boolean not null default false,
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > publish_at)
);

create index if not exists announcement_listing_idx
  on public.announcement (pinned desc, publish_at desc);

alter table public.announcement enable row level security;

drop policy if exists announcement_admin_all on public.announcement;
create policy announcement_admin_all on public.announcement
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists announcement_public_read on public.announcement;
create policy announcement_public_read on public.announcement
  for select to anon, authenticated
  using (
    audience = 'public'
    and publish_at <= now()
    and (expires_at is null or expires_at > now())
  );

drop policy if exists announcement_staff_read on public.announcement;
create policy announcement_staff_read on public.announcement
  for select to authenticated
  using (
    audience = 'staff'
    and public.my_role() in ('admin','club_manager','referee')
    and publish_at <= now()
    and (expires_at is null or expires_at > now())
  );

revoke all on public.announcement from anon;
grant select on public.announcement to anon;
grant select, insert, update, delete on public.announcement to authenticated;

create or replace function public.touch_announcement()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists announcement_touch on public.announcement;
create trigger announcement_touch
  before update on public.announcement
  for each row execute function public.touch_announcement();
