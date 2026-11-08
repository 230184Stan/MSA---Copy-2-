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
