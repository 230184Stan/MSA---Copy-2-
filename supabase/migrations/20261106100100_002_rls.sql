/*
# 002 — Role helpers and Row Level Security

Roles: admin, club_manager, referee, public (signed-in with no extra rights).
Anyone (even signed out) can read the public data: divisions, clubs, teams, seasons,
competitions, and PUBLISHED matches.

Helpers (SECURITY DEFINER so they can read profiles without recursing into RLS):
  my_role(), my_club_id(), is_admin()

Key protections
- Nobody can promote themselves: only admins can change profiles.role / club_id.
- Club managers only see and edit their own club's teams, registrations and players.
- Referees can only update matches assigned to them.
- Unpublished matches are invisible to the public.
*/

-- ---------- helpers ----------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as
$$ select coalesce((select role from public.profiles where id = auth.uid()), 'public') $$;

create or replace function public.my_club_id()
returns uuid language sql stable security definer set search_path = public as
$$ select club_id from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() = 'admin' $$;

grant execute on function public.my_role(), public.my_club_id(), public.is_admin()
  to anon, authenticated;

-- ---------- enable RLS everywhere ----------
alter table public.profiles          enable row level security;
alter table public.division          enable row level security;
alter table public.club              enable row level security;
alter table public.season            enable row level security;
alter table public.team              enable row level security;
alter table public.competition       enable row level security;
alter table public.competition_entry enable row level security;
alter table public.match             enable row level security;
alter table public.player            enable row level security;
alter table public.registration      enable row level security;
alter table public.division_move     enable row level security;
alter table public.transfer_window   enable row level security;
alter table public.match_event       enable row level security;

-- ---------- profiles ----------
drop policy if exists profiles_read_own_or_admin on public.profiles;
create policy profiles_read_own_or_admin on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- public reference data: everyone reads, admin writes ----------
do $$
declare t text;
begin
  foreach t in array array['division','club','season','competition','competition_entry']
  loop
    execute format('drop policy if exists %I on public.%I', t||'_public_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t||'_public_read', t);
    execute format('drop policy if exists %I on public.%I', t||'_admin_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t||'_admin_write', t);
  end loop;
end $$;

-- ---------- team ----------
drop policy if exists team_public_read on public.team;
create policy team_public_read on public.team
  for select to anon, authenticated using (true);

drop policy if exists team_insert_own_club_or_admin on public.team;
create policy team_insert_own_club_or_admin on public.team
  for insert to authenticated
  with check (public.is_admin() or (public.my_role() = 'club_manager' and club_id = public.my_club_id()));

drop policy if exists team_update_own_club_or_admin on public.team;
create policy team_update_own_club_or_admin on public.team
  for update to authenticated
  using      (public.is_admin() or (public.my_role() = 'club_manager' and club_id = public.my_club_id()))
  with check (public.is_admin() or (public.my_role() = 'club_manager' and club_id = public.my_club_id()));

drop policy if exists team_admin_delete on public.team;
create policy team_admin_delete on public.team
  for delete to authenticated using (public.is_admin());

-- ---------- match ----------
drop policy if exists match_public_read_published on public.match;
create policy match_public_read_published on public.match
  for select to anon, authenticated using (published = true);

drop policy if exists match_staff_read on public.match;
create policy match_staff_read on public.match
  for select to authenticated using (
    public.is_admin()
    or referee_id = auth.uid()
    or exists (select 1 from public.team t
                where t.id in (match.home_team_id, match.away_team_id)
                  and t.club_id = public.my_club_id())
  );

drop policy if exists match_admin_write on public.match;
create policy match_admin_write on public.match
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists match_referee_update on public.match;
create policy match_referee_update on public.match
  for update to authenticated
  using (public.my_role() = 'referee' and referee_id = auth.uid())
  with check (public.my_role() = 'referee' and referee_id = auth.uid());

-- ---------- player ----------
drop policy if exists player_read on public.player;
create policy player_read on public.player
  for select to authenticated using (
    public.is_admin()
    or created_by = auth.uid()
    or exists (select 1 from public.registration r join public.team t on t.id = r.team_id
                where r.player_id = player.id and t.club_id = public.my_club_id())
  );

drop policy if exists player_insert on public.player;
create policy player_insert on public.player
  for insert to authenticated
  with check (public.is_admin() or public.my_role() = 'club_manager');

drop policy if exists player_update on public.player;
create policy player_update on public.player
  for update to authenticated
  using (public.is_admin() or (public.my_role() = 'club_manager' and (
          created_by = auth.uid()
          or exists (select 1 from public.registration r join public.team t on t.id = r.team_id
                      where r.player_id = player.id and t.club_id = public.my_club_id()))))
  with check (public.is_admin() or public.my_role() = 'club_manager');

drop policy if exists player_admin_delete on public.player;
create policy player_admin_delete on public.player
  for delete to authenticated using (public.is_admin());

-- ---------- registration ----------
drop policy if exists registration_read on public.registration;
create policy registration_read on public.registration
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.team t where t.id = registration.team_id and t.club_id = public.my_club_id())
  );

drop policy if exists registration_insert on public.registration;
create policy registration_insert on public.registration
  for insert to authenticated with check (
    public.is_admin()
    or (public.my_role() = 'club_manager'
        and exists (select 1 from public.team t where t.id = registration.team_id and t.club_id = public.my_club_id()))
  );

drop policy if exists registration_update on public.registration;
create policy registration_update on public.registration
  for update to authenticated
  using (
    public.is_admin()
    or (public.my_role() = 'club_manager'
        and exists (select 1 from public.team t where t.id = registration.team_id and t.club_id = public.my_club_id()))
  )
  with check (
    public.is_admin()
    or (public.my_role() = 'club_manager'
        and exists (select 1 from public.team t where t.id = registration.team_id and t.club_id = public.my_club_id()))
  );

drop policy if exists registration_admin_delete on public.registration;
create policy registration_admin_delete on public.registration
  for delete to authenticated using (public.is_admin());

-- ---------- division_move / transfer_window / match_event ----------
drop policy if exists division_move_read on public.division_move;
create policy division_move_read on public.division_move
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.registration r join public.team t on t.id = r.team_id
                where r.id in (division_move.from_registration_id, division_move.to_registration_id)
                  and t.club_id = public.my_club_id())
  );
drop policy if exists division_move_admin_write on public.division_move;
create policy division_move_admin_write on public.division_move
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists transfer_window_read on public.transfer_window;
create policy transfer_window_read on public.transfer_window
  for select to anon, authenticated using (true);
drop policy if exists transfer_window_admin_write on public.transfer_window;
create policy transfer_window_admin_write on public.transfer_window
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists match_event_public_read on public.match_event;
create policy match_event_public_read on public.match_event
  for select to anon, authenticated using (
    exists (select 1 from public.match m where m.id = match_event.match_id and m.published = true)
  );
drop policy if exists match_event_write on public.match_event;
create policy match_event_write on public.match_event
  for all to authenticated
  using (public.is_admin() or exists (select 1 from public.match m where m.id = match_event.match_id and m.referee_id = auth.uid()))
  with check (public.is_admin() or exists (select 1 from public.match m where m.id = match_event.match_id and m.referee_id = auth.uid()));

-- ---------- table privileges (Supabase normally grants these by default; explicit = safe) ----------
grant usage on schema public to anon, authenticated;
grant select on public.division, public.club, public.season, public.team, public.competition,
                public.competition_entry, public.match, public.match_event,
                public.transfer_window, public.standings to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.player, public.registration,
                public.division_move, public.team, public.club, public.division, public.season,
                public.competition, public.competition_entry, public.match, public.match_event,
                public.transfer_window to authenticated;
