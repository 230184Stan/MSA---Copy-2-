/*
# 018 — Scouting & eligibility profile (administrators only)

Adds what an association executive (technical director, national team manager, scout) needs
beyond match records:

  player_scouting  one optional row per player
                   - eligibility: citizenships, birthplace, heritage notes, cap status and caps
                   - tactical: secondary position, preferred foot, height, weight, system-fit notes
                   - intangibles: captaincy, leadership/character, big-game experience, general notes
  player_injury    an injury log per player: what, where, when, back when, games missed

Both tables are readable and writable by ADMINISTRATORS ONLY. They hold sensitive personal and
medical information (some of it about children), so club managers and referees cannot see them.
Deleting a player removes their scouting row and injuries too (cascade).

Safe to run more than once.
*/

create table if not exists public.player_scouting (
  player_id        uuid primary key references public.player(id) on delete cascade,
  citizenships     text[] not null default '{}',
  birthplace       text,
  heritage_notes   text,
  cap_status       text not null default 'uncapped'
                     check (cap_status in ('uncapped','youth','senior')),
  senior_caps      integer check (senior_caps is null or senior_caps >= 0),
  youth_caps       integer check (youth_caps is null or youth_caps >= 0),
  cap_notes        text,
  secondary_position text
                     check (secondary_position is null
                            or secondary_position in ('goalkeeper','defender','midfielder','forward')),
  preferred_foot   text check (preferred_foot is null or preferred_foot in ('left','right','both')),
  height_cm        integer check (height_cm is null or height_cm between 100 and 230),
  weight_kg        integer check (weight_kg is null or weight_kg between 25 and 160),
  system_fit_notes text,
  captaincy        text,
  leadership_notes text,
  big_game_notes   text,
  scouting_notes   text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null
);

create table if not exists public.player_injury (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.player(id) on delete cascade,
  injury       text not null check (length(btrim(injury)) > 0),
  body_area    text,
  injured_on   date not null,
  returned_on  date,
  games_missed integer check (games_missed is null or games_missed >= 0),
  notes        text,
  created_at   timestamptz not null default now(),
  check (returned_on is null or returned_on >= injured_on)
);

create index if not exists player_injury_player_idx on public.player_injury (player_id, injured_on desc);

alter table public.player_scouting enable row level security;
alter table public.player_injury   enable row level security;

drop policy if exists player_scouting_admin on public.player_scouting;
create policy player_scouting_admin on public.player_scouting
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists player_injury_admin on public.player_injury;
create policy player_injury_admin on public.player_injury
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.player_scouting, public.player_injury from anon;
grant select, insert, update, delete on public.player_scouting, public.player_injury to authenticated;

create or replace function public.touch_player_scouting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists player_scouting_touch on public.player_scouting;
create trigger player_scouting_touch
  before insert or update on public.player_scouting
  for each row execute function public.touch_player_scouting();
