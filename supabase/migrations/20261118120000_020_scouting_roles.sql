/*
# 020 — Who can see and fill in the scouting details

Splits the scouting data by sensitivity, and enforces it in the database (not just the app):

  player_details   NEW. Facts the player's own club knows: birthplace, secondary position,
                   preferred foot, height, weight.
                   -> administrators, and the manager of the club the player is CURRENTLY
                      registered to.
  player_injury    Injury log.
                   -> the same two groups.
  player_scouting  Judgement notes only: system fit, captaincy, leadership/character,
                   big-game experience, scouting notes.
                   -> ADMINISTRATORS ONLY. Club managers cannot read these at all.

"Manager of the player's club" means: a club_manager whose club has the player on an active
or suspended registration, or who created the player and the player has no current
registration anywhere yet (so a manager can fill in a player they have just added).
A manager whose player has moved to another club immediately loses access to that player.
Referees and the public have no access to any of it.

Existing birthplace/position/foot/height/weight values are copied across before the columns
are removed from player_scouting. Safe to run more than once.
*/

-- ---------- who may edit a player's details ----------
create or replace function public.can_edit_player_details(p_player_id uuid)
returns boolean
language sql stable security definer set search_path = public as
$$
  select public.is_admin()
      or (
        public.my_role() = 'club_manager'
        and public.my_club_id() is not null
        and (
          exists (
            select 1 from public.registration r
              join public.team t on t.id = r.team_id
             where r.player_id = p_player_id
               and r.status in ('active','suspended')
               and t.club_id = public.my_club_id()
          )
          or (
            exists (select 1 from public.player p
                     where p.id = p_player_id and p.created_by = auth.uid())
            and not exists (select 1 from public.registration r
                             where r.player_id = p_player_id and r.status in ('active','suspended'))
          )
        )
      )
$$;
revoke all on function public.can_edit_player_details(uuid) from public, anon;
grant execute on function public.can_edit_player_details(uuid) to authenticated;

-- ---------- player_details ----------
create table if not exists public.player_details (
  player_id          uuid primary key references public.player(id) on delete cascade,
  birthplace         text,
  secondary_position text
                       check (secondary_position is null
                              or secondary_position in ('goalkeeper','defender','midfielder','forward')),
  preferred_foot     text check (preferred_foot is null or preferred_foot in ('left','right','both')),
  height_cm          integer check (height_cm is null or height_cm between 100 and 230),
  weight_kg          integer check (weight_kg is null or weight_kg between 25 and 160),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id) on delete set null
);

-- copy what was already typed into player_scouting, then drop those columns there
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'player_scouting'
                and column_name = 'birthplace') then
    execute $q$
      insert into public.player_details
        (player_id, birthplace, secondary_position, preferred_foot, height_cm, weight_kg)
      select player_id, birthplace, secondary_position, preferred_foot, height_cm, weight_kg
        from public.player_scouting
       where coalesce(birthplace, secondary_position, preferred_foot) is not null
          or height_cm is not null or weight_kg is not null
      on conflict (player_id) do nothing
    $q$;
    alter table public.player_scouting
      drop column if exists birthplace,
      drop column if exists secondary_position,
      drop column if exists preferred_foot,
      drop column if exists height_cm,
      drop column if exists weight_kg;
  end if;
end $$;

alter table public.player_details enable row level security;

drop policy if exists player_details_access on public.player_details;
create policy player_details_access on public.player_details
  for all to authenticated
  using (public.can_edit_player_details(player_id))
  with check (public.can_edit_player_details(player_id));

revoke all on public.player_details from anon;
grant select, insert, update, delete on public.player_details to authenticated;

create or replace function public.touch_player_details()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists player_details_touch on public.player_details;
create trigger player_details_touch
  before insert or update on public.player_details
  for each row execute function public.touch_player_details();

-- ---------- player_injury: admins and the player's own club manager ----------
alter table public.player_injury
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;

drop policy if exists player_injury_admin on public.player_injury;
drop policy if exists player_injury_access on public.player_injury;
create policy player_injury_access on public.player_injury
  for all to authenticated
  using (public.can_edit_player_details(player_id))
  with check (public.can_edit_player_details(player_id));

-- ---------- player_scouting stays administrators only (re-asserted) ----------
drop policy if exists player_scouting_admin on public.player_scouting;
create policy player_scouting_admin on public.player_scouting
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
