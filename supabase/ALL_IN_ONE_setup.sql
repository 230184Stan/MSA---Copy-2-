-- MSA: complete database setup (migrations 001-009 in order).
-- Paste into Supabase > SQL Editor > New query > Run.

-- ================= 20261106100000_001_schema.sql =================
/*
# 001 — Core schema (rebuilt; replaces the original Bolt migration that was never exported)

Tables: profiles, division, club, team, season, competition, competition_entry,
        player, registration, division_move, transfer_window, match, match_event
View:   standings (calculated from published, completed matches — never stored by hand)

Design notes
- Column names match what the React app and migrations 003-007 already use.
- Unique constraints match the ON CONFLICT clauses in the seed migrations.
- player.created_by lets a club manager see a player they just created, before the
  registration row exists (otherwise INSERT ... RETURNING would be blocked by RLS).
- registration.start_date defaults to today because the app does not send it.
- The eligibility trigger and the one-active-registration index live in migration 007.
*/

create extension if not exists pgcrypto;

-- ---------- reference data ----------
create table if not exists public.division (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  gender_rule text check (gender_rule in ('male','female','any')),
  max_age     integer,
  level       integer,
  created_at  timestamptz not null default now()
);

create table if not exists public.club (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  founded    integer,
  contact    text,
  created_at timestamptz not null default now()
);

create table if not exists public.season (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  start_date   date not null,
  end_date     date not null,
  cut_off_date date,
  is_current   boolean not null default false,
  created_at   timestamptz not null default now(),
  check (end_date > start_date)
);
-- at most one current season
create unique index if not exists one_current_season
  on public.season (is_current) where is_current;

-- ---------- people & access ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  role       text not null default 'public'
             check (role in ('admin','club_manager','referee','public')),
  club_id    uuid references public.club(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.team (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.club(id) on delete cascade,
  name        text not null,
  division_id uuid references public.division(id),
  created_at  timestamptz not null default now(),
  unique (club_id, name)
);

-- ---------- competitions ----------
create table if not exists public.competition (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references public.season(id) on delete cascade,
  division_id uuid not null references public.division(id),
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (season_id, division_id)
);

create table if not exists public.competition_entry (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competition(id) on delete cascade,
  team_id        uuid not null references public.team(id) on delete cascade,
  unique (competition_id, team_id)
);

create table if not exists public.match (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competition(id) on delete cascade,
  home_team_id   uuid not null references public.team(id),
  away_team_id   uuid not null references public.team(id),
  kickoff_at     timestamptz not null,
  venue          text,
  status         text not null default 'scheduled'
                 check (status in ('scheduled','live','completed','postponed','forfeit')),
  home_score     integer check (home_score >= 0),
  away_score     integer check (away_score >= 0),
  published      boolean not null default false,
  referee_id     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);
create index if not exists match_competition_idx on public.match (competition_id, kickoff_at);

-- ---------- players & registrations ----------
create table if not exists public.player (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  dob        date not null,
  gender     text not null check (gender in ('male','female')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.registration (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.player(id) on delete cascade,
  team_id     uuid not null references public.team(id),
  division_id uuid not null references public.division(id),
  season_id   uuid not null references public.season(id),
  status      text not null default 'active'
              check (status in ('active','ended','suspended')),
  start_date  date not null default current_date,
  end_date    date,
  created_at  timestamptz not null default now()
);
create index if not exists registration_player_idx on public.registration (player_id);
create index if not exists registration_team_idx   on public.registration (team_id);

create table if not exists public.division_move (
  id                   uuid primary key default gen_random_uuid(),
  player_id            uuid not null references public.player(id) on delete cascade,
  from_registration_id uuid references public.registration(id),
  to_registration_id   uuid references public.registration(id),
  move_type            text not null check (move_type in ('up','down','transfer')),
  reason               text,
  status               text not null default 'requested'
                       check (status in ('requested','club_approved','admin_approved','completed','rejected')),
  requested_by         uuid references auth.users(id),
  club_approved_by     uuid references auth.users(id),
  club_approved_at     timestamptz,
  admin_approved_by    uuid references auth.users(id),
  admin_approved_at    timestamptz,
  created_at           timestamptz not null default now()
);

create table if not exists public.transfer_window (
  id        uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.season(id) on delete cascade,
  opens_on  date not null,
  closes_on date not null,
  check (closes_on > opens_on)
);

create table if not exists public.match_event (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.match(id) on delete cascade,
  registration_id uuid references public.registration(id),
  event_type      text not null check (event_type in ('goal','yellow_card','red_card','substitution')),
  minute          integer check (minute between 0 and 150),
  created_at      timestamptz not null default now()
);

-- ---------- standings (win 3, draw 1, loss 0) ----------
-- security_invoker: the view obeys the caller's RLS, so the public only ever sees
-- standings built from PUBLISHED matches.
create or replace view public.standings
with (security_invoker = true) as
with results as (
  select competition_id, home_team_id as team_id,
         home_score as gf, away_score as ga
    from public.match
   where status in ('completed','forfeit') and home_score is not null and away_score is not null
  union all
  select competition_id, away_team_id,
         away_score, home_score
    from public.match
   where status in ('completed','forfeit') and home_score is not null and away_score is not null
)
select competition_id,
       team_id,
       count(*)::int                                   as played,
       count(*) filter (where gf > ga)::int            as wins,
       count(*) filter (where gf = ga)::int            as draws,
       count(*) filter (where gf < ga)::int            as losses,
       sum(gf)::int                                    as goals_for,
       sum(ga)::int                                    as goals_against,
       (sum(gf) - sum(ga))::int                        as goal_difference,
       (count(*) filter (where gf > ga) * 3
        + count(*) filter (where gf = ga))::int        as points
  from results
 group by competition_id, team_id;

-- ================= 20261106100100_002_rls.sql =================
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

-- ================= 20261106124853_003_seed_divisions.sql.sql =================
/*
# Seed data: five divisions, current season, demo clubs/teams/competitions

1. Divisions (the five required)
   - Men's A   (gender male, no age limit, level 1 — top tier)
   - Men's B   (gender male, no age limit, level 2)
   - Men's C   (gender male, no age limit, level 3 — entry level)
   - Under 18  (gender any, max_age 17, no level — eligibility by date of birth)
   - Women's   (gender female, no age limit, no level — eligibility by gender)

   Note: Under 18 max_age is stored as 17, meaning "under 18". The eligibility
   check compares the player's age against season.cut_off_date. The cut-off date
   is stored on the season row, NOT hard-coded.

2. Season
   - "2026" season, Jan–Dec 2026, cut_off_date 2008-01-01 (a player must have
     been born on or after this date to qualify for Under 18 in the 2026 season).
   - Marked is_current = true.

3. Demo clubs & teams
   - Two clubs: "Port Moresby Rangers" and "Lae United".
   - One team per club in Men's A, for the Men's A 2026 competition.

4. Competitions
   - "Men's A 2026" competition (division Men's A + season 2026).
   - Competition entries for both demo teams.

5. Notes
   - Seeded rows use fixed UUIDs so later migrations can reference them by id.
   - No auth.users rows are seeded here (per Supabase guidance — never put
     user accounts in a migration). Admin/manager accounts are created in Phase 2.
*/

-- DIVISIONS (fixed UUIDs for stable reference)
insert into division (id, name, gender_rule, max_age, level) values
  ('11111111-0000-0000-0000-000000000001', 'Men''s A',  'male',   null, 1),
  ('11111111-0000-0000-0000-000000000002', 'Men''s B',  'male',   null, 2),
  ('11111111-0000-0000-0000-000000000003', 'Men''s C',  'male',   null, 3),
  ('11111111-0000-0000-0000-000000000004', 'Under 18', 'any',    17,   null),
  ('11111111-0000-0000-0000-000000000005', 'Women''s',  'female', null, null)
on conflict (name) do update set
  gender_rule = excluded.gender_rule,
  max_age     = excluded.max_age,
  level       = excluded.level;

-- SEASON 2026 (fixed UUID)
insert into season (id, name, start_date, end_date, cut_off_date, is_current) values
  ('22222222-0000-0000-0000-000000000001', '2026',
   date '2026-01-15', date '2026-12-15',
   date '2008-01-01', true)
on conflict (name) do update set
  start_date   = excluded.start_date,
  end_date     = excluded.end_date,
  cut_off_date = excluded.cut_off_date,
  is_current   = excluded.is_current;

-- DEMO CLUBS
insert into club (id, name, founded, contact) values
  ('33333333-0000-0000-0000-000000000001', 'Port Moresby Rangers', 1998, 'rangers@example.org'),
  ('33333333-0000-0000-0000-000000000002', 'Lae United',           2001, 'united@example.org')
on conflict (name) do update set
  founded = excluded.founded,
  contact = excluded.contact;

-- DEMO TEAMS (one per club in Men's A)
insert into team (id, club_id, name, division_id) values
  ('44444444-0000-0000-0000-000000000001',
   '33333333-0000-0000-0000-000000000001',
   'Rangers FC',
   '11111111-0000-0000-0000-000000000001'),
  ('44444444-0000-0000-0000-000000000002',
   '33333333-0000-0000-0000-000000000002',
   'Lae United FC',
   '11111111-0000-0000-0000-000000000001')
on conflict (club_id, name) do update set
  division_id = excluded.division_id;

-- COMPETITION: Men's A 2026
insert into competition (id, season_id, division_id, name) values
  ('55555555-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   'Men''s A 2026')
on conflict (season_id, division_id) do update set name = excluded.name;

-- COMPETITION ENTRIES
insert into competition_entry (competition_id, team_id) values
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001'),
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002')
on conflict (competition_id, team_id) do nothing;

-- ================= 20261106125009_004_fix_team_insert_policy.sql.sql =================
/*
# Fix team INSERT policy

The team insert policy incorrectly called club_of_team(club_id), which treats the
club_id column value as a team id. The correct check is a direct comparison:
club_id = my_club_id(). This matches the UPDATE policy already in place.

1. Security change
   - Drop and recreate the "team_insert_own_club_or_admin" policy with the
     correct predicate.
*/

drop policy if exists "team_insert_own_club_or_admin" on team;
create policy "team_insert_own_club_or_admin" on team
  for insert to authenticated
  with check (public.is_admin() or club_id = public.my_club_id());

-- ================= 20261106125733_005_auto_profile.sql.sql =================
/*
# Auto-create profile on signup

1. Overview
   When a new user registers via Supabase Auth, a row must exist in `profiles`
   so the role helpers (my_role, my_club_id, is_admin) return a sensible value
   instead of treating every signed-in user as 'public' with no club link.

2. Changes
   - `handle_new_user()` — a SECURITY DEFINER trigger function that inserts a
     `profiles` row with id = the new auth user, role defaulting to 'public',
     and full_name copied from raw_user_meta_data if provided at signup.
   - `on_auth_user_created` trigger on `auth.users` calling the function AFTER INSERT.

3. Security
   - The function is SECURITY DEFINER (runs as postgres) so it can insert into
     `profiles` even though the anon role normally can't write there through RLS.
   - EXECUTE is revoked from PUBLIC/anon and granted only to authenticated and
     service_role (the trigger runs as the owner, so this is belt-and-braces).
   - The function sets a strict search_path to avoid schema-injection.
*/

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'public'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon;
grant execute on function public.handle_new_user() to authenticated, service_role;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ================= 20261107004740_006_phase3_madang_clubs_and_sample_matches.sql.sql =================
/*
# Phase 3 — Madang club rebrand + sample matches

## Purpose
Rebrands the two demo clubs from the national template to Madang-area clubs
and seeds published sample matches (3 completed, 2 scheduled) in the Men's A
2026 competition so Fixtures / Results / Standings pages show data.

## 1. Club rebrand (UPDATE, no rows dropped)
- "Port Moresby Rangers" -> "Madang Rangers"
- "Lae United"            -> "Coastal United"

## 2. Team rebrand (UPDATE)
- "Lae United FC" -> "Coastal United FC"

## 3. Sample matches in Men's A 2026
3 completed+published, 2 scheduled+published. Weekly cadence.

## 4. Security
No new tables/policies. All matches published=true so the existing
match_public_read_published policy exposes them.

## 5. Idempotency
Rebrands are UPDATE ... WHERE name='<old>' (no-op if already done).
Matches are guarded by NOT EXISTS so re-running is safe.
*/

-- 1. Rebrand clubs
UPDATE club SET name = 'Madang Rangers', founded = 1998, contact = 'rangers@example.org'
  WHERE name = 'Port Moresby Rangers';

UPDATE club SET name = 'Coastal United', founded = 2001, contact = 'united@example.org'
  WHERE name = 'Lae United';

-- 2. Rebrand team
UPDATE team SET name = 'Coastal United FC'
  WHERE name = 'Lae United FC';

-- 3. Seed matches (Rangers as home in slots 1,3,4,5; Coastal home in slot 2)
INSERT INTO match (competition_id, home_team_id, away_team_id, kickoff_at, venue, status, home_score, away_score, published)
SELECT '55555555-0000-0000-0000-000000000001',
       '44444444-0000-0000-0000-000000000001',
       '44444444-0000-0000-0000-000000000002',
       v.kickoff, v.venue, v.status, v.hs, v.away, true
FROM (VALUES
  ('2026-10-10 14:00:00+10'::timestamptz, 'Madang Sports Field 1', 'completed', 2, 1),
  ('2026-10-24 14:00:00+10'::timestamptz, 'Madang Sports Field 1', 'completed', 1, 1),
  ('2026-11-14 14:00:00+10'::timestamptz, 'Madang Sports Field 2', 'scheduled', NULL, NULL),
  ('2026-11-21 14:00:00+10'::timestamptz, 'Madang Sports Field 1', 'scheduled', NULL, NULL)
) AS v(kickoff, venue, status, hs, away)
WHERE NOT EXISTS (
  SELECT 1 FROM match m
  WHERE m.competition_id = '55555555-0000-0000-0000-000000000001'
    AND m.home_team_id   = '44444444-0000-0000-0000-000000000001'
    AND m.away_team_id   = '44444444-0000-0000-0000-000000000002'
    AND m.kickoff_at     = v.kickoff
);

-- Coastal United home game (round 2): 0 - 3
INSERT INTO match (competition_id, home_team_id, away_team_id, kickoff_at, venue, status, home_score, away_score, published)
SELECT '55555555-0000-0000-0000-000000000001',
       '44444444-0000-0000-0000-000000000002',
       '44444444-0000-0000-0000-000000000001',
       '2026-10-17 14:00:00+10'::timestamptz, 'Madang Sports Field 2', 'completed', 0, 3, true
WHERE NOT EXISTS (
  SELECT 1 FROM match m
  WHERE m.competition_id = '55555555-0000-0000-0000-000000000001'
    AND m.home_team_id   = '44444444-0000-0000-0000-000000000002'
    AND m.away_team_id   = '44444444-0000-0000-0000-000000000001'
    AND m.kickoff_at     = '2026-10-17 14:00:00+10'::timestamptz
);

-- ================= 20261107120000_007_registration_rules.sql =================
/*
# Registration rules enforced in the database

## Why
The Players page now checks eligibility, but a form check can be bypassed (another
client, the API, a bug). These rules must hold no matter who writes to `registration`.

## 1. One active registration per player
- Partial unique index `one_active_registration` (player_id WHERE status = 'active').
- `IF NOT EXISTS` makes this safe if migration 001 already created it.

## 2. Eligibility on every active registration
- `check_registration_eligibility()` trigger runs BEFORE INSERT/UPDATE on `registration`.
- Only checks rows with status = 'active' (ending or suspending a row is never blocked).
- Gender: division.gender_rule 'male' / 'female' must match player.gender ('any' = no check).
- Age: if division.max_age IS NOT NULL (Under 18), the player must be born ON OR AFTER
  season.cut_off_date. The cut-off lives on the season row, never hard-coded.
  To make the boundary exclusive instead, change `<` to `<=` below AND in
  src/lib/eligibility.ts.

## 3. Security
- SECURITY DEFINER with a fixed search_path so the check can always read
  player/division/season regardless of the caller's RLS visibility.
- Trigger functions need no EXECUTE grant to fire, so EXECUTE is revoked from everyone.
*/

create unique index if not exists one_active_registration
  on public.registration (player_id)
  where status = 'active';

create or replace function public.check_registration_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dob       date;
  v_gender    text;
  v_div_name  text;
  v_rule      text;
  v_max_age   integer;
  v_season    text;
  v_cutoff    date;
begin
  if new.status is distinct from 'active' then
    return new;
  end if;

  select p.dob, p.gender::text
    into v_dob, v_gender
    from public.player p
   where p.id = new.player_id;

  select d.name, d.gender_rule::text, d.max_age
    into v_div_name, v_rule, v_max_age
    from public.division d
   where d.id = new.division_id;

  select s.name, s.cut_off_date
    into v_season, v_cutoff
    from public.season s
   where s.id = new.season_id;

  if v_dob is null or v_div_name is null then
    raise exception 'Cannot register: player or division not found.'
      using errcode = 'check_violation';
  end if;

  if v_rule in ('male', 'female') and v_gender is distinct from v_rule then
    raise exception '% is for % players only.', v_div_name, v_rule
      using errcode = 'check_violation';
  end if;

  if v_max_age is not null then
    if v_cutoff is null then
      raise exception 'Season % has no age cut-off date set.', v_season
        using errcode = 'check_violation';
    end if;
    if v_dob < v_cutoff then
      raise exception '% is for players born on or after %. This player is too old.',
        v_div_name, v_cutoff
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.check_registration_eligibility() from public, anon, authenticated;

drop trigger if exists registration_eligibility on public.registration;
create trigger registration_eligibility
  before insert or update of player_id, division_id, season_id, status
  on public.registration
  for each row execute function public.check_registration_eligibility();

-- ================= 20261107130000_008_season_switch_and_match_guards.sql =================
/*
# 008 — Safe season switch, referee guard, completed-match rule

## 1. set_current_season(season_id)
Making a season "current" needs two updates (unset the old one, set the new one).
Doing that from the browser could leave zero or two current seasons if a request
failed half-way. This function does both in one transaction and checks the caller
is an admin.

## 2. Referees can only change scores and status
The RLS policy lets a referee UPDATE their assigned matches, but RLS cannot limit
WHICH columns change. The trigger below rejects any non-admin change to the teams,
competition, kick-off time, venue, published flag or assigned referee.
(SQL run directly in the Supabase editor has no signed-in user, so it is allowed.)

## 3. A completed or forfeited match must have both scores
Otherwise it would be silently left out of the standings.
*/

create or replace function public.set_current_season(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only administrators can change the current season.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.season where id = p_season_id) then
    raise exception 'Season not found.' using errcode = 'P0002';
  end if;
  update public.season set is_current = false where is_current and id <> p_season_id;
  update public.season set is_current = true  where id = p_season_id;
end;
$$;

revoke execute on function public.set_current_season(uuid) from public, anon;
grant  execute on function public.set_current_season(uuid) to authenticated;

create or replace function public.restrict_match_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.competition_id is distinct from old.competition_id
     or new.home_team_id is distinct from old.home_team_id
     or new.away_team_id is distinct from old.away_team_id
     or new.kickoff_at   is distinct from old.kickoff_at
     or new.venue        is distinct from old.venue
     or new.published    is distinct from old.published
     or new.referee_id   is distinct from old.referee_id then
    raise exception 'Referees can only change the score and match status.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists match_restrict_update on public.match;
create trigger match_restrict_update
  before update on public.match
  for each row execute function public.restrict_match_update();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'match_result_needs_scores') then
    alter table public.match
      add constraint match_result_needs_scores
      check (status not in ('completed','forfeit')
             or (home_score is not null and away_score is not null));
  end if;
end $$;

-- ================= 20261107140000_009_division_moves.sql =================
/*
# 009 — Division moves (Phase 6)

## The flow
  request  ->  [receiving club approves, only if the player changes club]  ->  admin approves  ->  done
  Statuses: requested -> club_approved -> completed   (or rejected at any stage)

- Club manager requests for a player at THEIR club. Their request counts as the releasing club's approval.
- Same club: goes straight to club_approved (waiting for the association).
- Different club: stays "requested" until a manager of the RECEIVING club approves.
- Admin requests skip the club approvals (the association has final say), but still need a reason
  outside a transfer window.
- Admin approval performs the move in ONE transaction: end old registration, open new one,
  log it. A player can never end up with zero or two active registrations.

## Rules enforced here
- Player must have an active (not suspended) registration in the CURRENT season.
- Target team must have a division and differ from the current team.
- Eligibility (gender / Under 18 cut-off) is re-checked at request AND at completion.
- Moving DOWN needs a reason.
- Outside a transfer window only an admin may request, and must give a reason.
  (No windows defined for the season = closed.)
- One move in progress per player.

## Closing loopholes
RLS lets club managers update/insert registrations, which would bypass this whole flow.
`guard_registration_changes` blocks non-admins from (a) changing a registration's player,
team, division or season, and (b) opening a registration in a different division from one the
player already held this season. Only the move functions (which set app.division_move) may.
Known remaining gap: a manager can still register a player who was released by ANOTHER club
into the same division. A "release/clearance" step is a later improvement.

## Also
- player_eligibility_error() is now the single source of truth; the 007 trigger calls it.
*/

-- ---------- extra columns ----------
alter table public.division_move
  add column if not exists from_team_id          uuid references public.team(id),
  add column if not exists to_team_id            uuid references public.team(id),
  add column if not exists receiving_approved_by uuid references auth.users(id),
  add column if not exists receiving_approved_at timestamptz,
  add column if not exists rejected_reason       text;

create index if not exists division_move_player_idx on public.division_move (player_id);

-- ---------- single source of truth for eligibility ----------
create or replace function public.player_eligibility_error(p_player uuid, p_division uuid, p_season uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_dob date; v_gender text;
  v_div_name text; v_rule text; v_max_age integer;
  v_season text; v_cutoff date;
begin
  select p.dob, p.gender::text into v_dob, v_gender from public.player p where p.id = p_player;
  select d.name, d.gender_rule::text, d.max_age into v_div_name, v_rule, v_max_age
    from public.division d where d.id = p_division;
  select s.name, s.cut_off_date into v_season, v_cutoff from public.season s where s.id = p_season;

  if v_dob is null or v_div_name is null then
    return 'Player or division not found.';
  end if;
  if v_rule in ('male','female') and v_gender is distinct from v_rule then
    return format('%s is for %s players only.', v_div_name, v_rule);
  end if;
  if v_max_age is not null then
    if v_cutoff is null then
      return format('Season %s has no age cut-off date set.', v_season);
    end if;
    if v_dob < v_cutoff then
      return format('%s is for players born on or after %s. This player is too old.', v_div_name, v_cutoff);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.player_eligibility_error(uuid, uuid, uuid) from public, anon, authenticated;

-- 007's trigger now delegates to it (same rules, same messages)
create or replace function public.check_registration_eligibility()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_err text;
begin
  if new.status is distinct from 'active' then
    return new;
  end if;
  v_err := public.player_eligibility_error(new.player_id, new.division_id, new.season_id);
  if v_err is not null then
    raise exception '%', v_err using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_registration_eligibility() from public, anon, authenticated;

create or replace function public.in_transfer_window(p_season uuid, p_day date default current_date)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.transfer_window w
     where w.season_id = p_season and p_day between w.opens_on and w.closes_on
  )
$$;
revoke execute on function public.in_transfer_window(uuid, date) from public, anon, authenticated;

-- ---------- loophole guard ----------
create or replace function public.guard_registration_changes()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- SQL editor / migrations (no signed-in user), admins, and the move functions are trusted.
  if auth.uid() is null
     or public.is_admin()
     or coalesce(current_setting('app.division_move', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.player_id   is distinct from old.player_id
       or new.team_id     is distinct from old.team_id
       or new.division_id is distinct from old.division_id
       or new.season_id   is distinct from old.season_id then
      raise exception 'To change a player''s team or division, request a division move.';
    end if;
  elsif tg_op = 'INSERT' and new.status = 'active' then
    if exists (
      select 1 from public.registration r
       where r.player_id = new.player_id
         and r.season_id = new.season_id
         and r.division_id <> new.division_id
    ) then
      raise exception 'This player already had a registration in another division this season. Request a division move instead.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_registration_changes() from public, anon, authenticated;

drop trigger if exists registration_guard on public.registration;
create trigger registration_guard
  before insert or update on public.registration
  for each row execute function public.guard_registration_changes();

-- ---------- request ----------
create or replace function public.request_division_move(
  p_player_id uuid, p_to_team_id uuid, p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_role   text := public.my_role();
  v_club   uuid := public.my_club_id();
  v_season uuid;
  v_reg    public.registration%rowtype;
  v_from   public.team%rowtype;
  v_to     public.team%rowtype;
  v_fdiv   public.division%rowtype;
  v_tdiv   public.division%rowtype;
  v_type   text;
  v_err    text;
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_move   uuid;
begin
  if auth.uid() is null or v_role not in ('admin','club_manager') then
    raise exception 'Only club managers and administrators can request a move.';
  end if;

  select id into v_season from public.season where is_current;
  if v_season is null then
    raise exception 'No current season is set. Ask an administrator to set one.';
  end if;

  select * into v_reg from public.registration
   where player_id = p_player_id and status in ('active','suspended')
   order by created_at desc limit 1;
  if not found then
    raise exception 'This player has no active registration.';
  end if;
  if v_reg.status = 'suspended' then
    raise exception 'A suspended player cannot move divisions.';
  end if;
  if v_reg.season_id <> v_season then
    raise exception 'This player''s registration is from a past season. Ask an administrator to renew it.';
  end if;

  select * into v_from from public.team where id = v_reg.team_id;
  select * into v_to   from public.team where id = p_to_team_id;
  if v_to.id is null then
    raise exception 'Target team not found.';
  end if;
  if v_to.division_id is null then
    raise exception 'That team is not in a division yet.';
  end if;
  if v_to.id = v_from.id then
    raise exception 'The player is already on that team.';
  end if;

  if v_role = 'club_manager' and v_from.club_id is distinct from v_club then
    raise exception 'You can only request moves for players at your own club.';
  end if;

  if exists (select 1 from public.division_move
              where player_id = p_player_id and status in ('requested','club_approved')) then
    raise exception 'This player already has a move in progress.';
  end if;

  v_err := public.player_eligibility_error(p_player_id, v_to.division_id, v_season);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  select * into v_fdiv from public.division where id = v_reg.division_id;
  select * into v_tdiv from public.division where id = v_to.division_id;
  if v_fdiv.id = v_tdiv.id or v_fdiv.level is null or v_tdiv.level is null then
    v_type := 'transfer';
  elsif v_tdiv.level < v_fdiv.level then
    v_type := 'up';
  else
    v_type := 'down';
  end if;

  if v_type = 'down' and v_reason is null then
    raise exception 'A reason is required when moving a player down a division.';
  end if;

  if not public.in_transfer_window(v_season) then
    if v_role <> 'admin' then
      raise exception 'The transfer window is closed. Only an administrator can approve an exceptional move.';
    end if;
    if v_reason is null then
      raise exception 'A reason is required for a move outside the transfer window.';
    end if;
  end if;

  v_status := case
    when v_role = 'admin' then 'club_approved'                       -- association overrides club consent
    when v_to.club_id is distinct from v_from.club_id then 'requested' -- receiving club must agree
    else 'club_approved'
  end;

  insert into public.division_move
    (player_id, from_registration_id, from_team_id, to_team_id, move_type, reason, status,
     requested_by, club_approved_by, club_approved_at)
  values
    (p_player_id, v_reg.id, v_from.id, v_to.id, v_type, v_reason, v_status,
     auth.uid(),
     case when v_role = 'club_manager' then auth.uid() end,
     case when v_role = 'club_manager' then now() end)
  returning id into v_move;

  return v_move;
end;
$$;

-- ---------- complete (internal; only approve_division_move calls this) ----------
create or replace function public.complete_division_move(p_move_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m        public.division_move%rowtype;
  v_reg    public.registration%rowtype;
  v_to     public.team%rowtype;
  v_season uuid;
  v_err    text;
  v_new    uuid;
begin
  select * into m from public.division_move where id = p_move_id for update;
  select * into v_reg from public.registration where id = m.from_registration_id;
  if v_reg.id is null or v_reg.status <> 'active' then
    raise exception 'The player''s registration has changed since this was requested. Reject this request and start a new one.';
  end if;

  select id into v_season from public.season where is_current;
  if v_season is null then
    raise exception 'No current season is set.';
  end if;
  select * into v_to from public.team where id = m.to_team_id;
  if v_to.id is null or v_to.division_id is null then
    raise exception 'The target team is no longer available.';
  end if;

  v_err := public.player_eligibility_error(m.player_id, v_to.division_id, v_season);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  perform set_config('app.division_move', 'on', true);
  update public.registration set status = 'ended', end_date = current_date where id = v_reg.id;
  insert into public.registration (player_id, team_id, division_id, season_id, status, start_date)
  values (m.player_id, v_to.id, v_to.division_id, v_season, 'active', current_date)
  returning id into v_new;
  perform set_config('app.division_move', 'off', true);

  update public.division_move
     set status = 'completed', to_registration_id = v_new,
         admin_approved_by = auth.uid(), admin_approved_at = now()
   where id = p_move_id;
end;
$$;
revoke execute on function public.complete_division_move(uuid) from public, anon, authenticated;

-- ---------- approve ----------
create or replace function public.approve_division_move(p_move_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  m          public.division_move%rowtype;
  v_role     text := public.my_role();
  v_club     uuid := public.my_club_id();
  v_from_club uuid;
  v_to_club   uuid;
begin
  if auth.uid() is null or v_role not in ('admin','club_manager') then
    raise exception 'Only club managers and administrators can approve moves.';
  end if;

  select * into m from public.division_move where id = p_move_id for update;
  if not found then
    raise exception 'Move not found.';
  end if;
  if m.status not in ('requested','club_approved') then
    raise exception 'This move is already %.', m.status;
  end if;

  select club_id into v_from_club from public.team where id = m.from_team_id;
  select club_id into v_to_club   from public.team where id = m.to_team_id;

  if v_role = 'admin' then
    if m.status <> 'club_approved' then
      raise exception 'Waiting for the receiving club to approve first.';
    end if;
    perform public.complete_division_move(p_move_id);
    return 'completed';
  end if;

  if m.status = 'requested' and v_to_club = v_club and v_from_club is distinct from v_club then
    update public.division_move
       set status = 'club_approved', receiving_approved_by = auth.uid(), receiving_approved_at = now()
     where id = p_move_id;
    return 'club_approved';
  end if;

  raise exception 'There is nothing for your club to approve on this move.';
end;
$$;

-- ---------- reject ----------
create or replace function public.reject_division_move(p_move_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m          public.division_move%rowtype;
  v_role     text := public.my_role();
  v_club     uuid := public.my_club_id();
  v_from_club uuid;
  v_to_club   uuid;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or v_role not in ('admin','club_manager') then
    raise exception 'Only club managers and administrators can reject moves.';
  end if;
  if v_reason is null then
    raise exception 'Please give a reason for rejecting this move.';
  end if;

  select * into m from public.division_move where id = p_move_id for update;
  if not found then
    raise exception 'Move not found.';
  end if;
  if m.status not in ('requested','club_approved') then
    raise exception 'This move is already %.', m.status;
  end if;

  select club_id into v_from_club from public.team where id = m.from_team_id;
  select club_id into v_to_club   from public.team where id = m.to_team_id;
  if v_role = 'club_manager' and v_club is distinct from v_from_club and v_club is distinct from v_to_club then
    raise exception 'This move does not involve your club.';
  end if;

  update public.division_move set status = 'rejected', rejected_reason = v_reason where id = p_move_id;
end;
$$;

-- ---------- list (names joined, scoped to the caller, with what they may do) ----------
create or replace function public.my_division_moves()
returns table (
  id uuid, status text, move_type text, reason text, rejected_reason text, created_at timestamptz,
  player_id uuid, player_name text,
  from_team_name text, from_club_name text, from_division_name text,
  to_team_name text, to_club_name text, to_division_name text,
  can_approve boolean, can_reject boolean
)
language sql stable security definer set search_path = public
as $$
  with me as (select public.my_role() as role, public.my_club_id() as club)
  select m.id, m.status, m.move_type, m.reason, m.rejected_reason, m.created_at,
         m.player_id, p.full_name,
         ft.name, fc.name, fd.name,
         tt.name, tc.name, td.name,
         case
           when (select role from me) = 'admin' then m.status = 'club_approved'
           when (select role from me) = 'club_manager' then
                m.status = 'requested'
                and tt.club_id = (select club from me)
                and ft.club_id is distinct from (select club from me)
           else false
         end,
         m.status in ('requested','club_approved') and (
           (select role from me) = 'admin'
           or ((select role from me) = 'club_manager'
               and (select club from me) in (ft.club_id, tt.club_id))
         )
    from public.division_move m
    join public.player p on p.id = m.player_id
    left join public.team ft on ft.id = m.from_team_id
    left join public.club fc on fc.id = ft.club_id
    left join public.registration fr on fr.id = m.from_registration_id
    left join public.division fd on fd.id = fr.division_id
    left join public.team tt on tt.id = m.to_team_id
    left join public.club tc on tc.id = tt.club_id
    left join public.division td on td.id = tt.division_id
   where (select role from me) = 'admin'
      or ((select role from me) = 'club_manager'
          and (select club from me) in (ft.club_id, tt.club_id))
   order by (m.status in ('requested','club_approved')) desc, m.created_at desc
$$;

-- ---------- who may call what ----------
revoke execute on function public.request_division_move(uuid, uuid, text) from public, anon;
revoke execute on function public.approve_division_move(uuid)             from public, anon;
revoke execute on function public.reject_division_move(uuid, text)        from public, anon;
revoke execute on function public.my_division_moves()                     from public, anon;
grant  execute on function public.request_division_move(uuid, uuid, text) to authenticated;
grant  execute on function public.approve_division_move(uuid)             to authenticated;
grant  execute on function public.reject_division_move(uuid, text)        to authenticated;
grant  execute on function public.my_division_moves()                     to authenticated;
