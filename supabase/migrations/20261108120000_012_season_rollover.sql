/*
# 012 — Season rollover (Phase 9)

## The problem
Registrations belong to ONE season. When a new season starts, nobody is registered in it, and
Under 18 players who have passed the new age cut-off are no longer eligible for their division.

## Order of work (admin)
  1. Seasons page: create the new season WITH its age cut-off date, and its transfer windows.
  2. Season rollover page: PREVIEW. Club managers can already see their "ageing out" players here.
  3. Run the rollover (one all-or-nothing step).
  4. Make the new season current.
  5. Club managers propose moves up for players who were placed in the entry-level division,
     using the normal Division moves page (club + admin approval, inside the transfer window).

## What run_season_rollover(from, to) does, in ONE transaction
  - For every ACTIVE registration in the old season:
      * still eligible          -> old one ended, same team/division registered in the new season
      * no longer eligible      -> old one ended, player placed in the club's team in the default
                                   division: men -> the entry-level men's division (highest level
                                   number, i.e. Men's C); women -> the women's division.
                                   If the club has no such team the player is left UNPLACED
                                   (no active registration) and appears in the "needs a team" list.
      * already registered in the new season (e.g. entered by hand) -> left alone
  - Unserved suspensions are made "any competition" so they can still be served next season
    (otherwise they would be tied to last season's competition forever).
  - Division moves still in progress are rejected (their starting registration just ended);
    the clubs are asked to request them again.
  - A record of every player's outcome is kept (season_rollover_item).

## Safety
  - Admin only. Refuses if the new season does not start after the old one, if it has no age
    cut-off date (when Under 18 players exist), or if the rollover was already done.
  - Nothing is changed unless everything succeeds.
  - Only status = 'active' registrations are carried over. (The old 'suspended' registration
    status is unused: suspensions live in the suspension table since migration 011.)

Known gaps: competition entries (which teams play in which competition) are NOT copied to the
new season; they are set up on the Competitions page. Clubs are not notified automatically
(announcements come in a later phase); the preview page is how managers see who is ageing out.
*/

create table if not exists public.season_rollover (
  id                 uuid primary key default gen_random_uuid(),
  from_season_id     uuid not null references public.season(id),
  to_season_id       uuid not null unique references public.season(id),
  done_by            uuid references auth.users(id) default auth.uid(),
  done_at            timestamptz not null default now(),
  carried            integer not null default 0,
  aged_out_placed    integer not null default 0,
  aged_out_unplaced  integer not null default 0,
  skipped            integer not null default 0,
  moves_rejected     integer not null default 0,
  suspensions_updated integer not null default 0
);

create table if not exists public.season_rollover_item (
  id                   uuid primary key default gen_random_uuid(),
  rollover_id          uuid not null references public.season_rollover(id) on delete cascade,
  player_id            uuid not null references public.player(id) on delete cascade,
  from_registration_id uuid references public.registration(id),
  to_registration_id   uuid references public.registration(id),
  outcome              text not null check (outcome in ('carried','aged_out_placed','aged_out_unplaced','skipped'))
);
create index if not exists season_rollover_item_rollover_idx on public.season_rollover_item (rollover_id);

alter table public.season_rollover      enable row level security;
alter table public.season_rollover_item enable row level security;

drop policy if exists season_rollover_read on public.season_rollover;
create policy season_rollover_read on public.season_rollover for select to authenticated using (true);
revoke all on public.season_rollover from anon;
revoke all on public.season_rollover_item from anon, authenticated;
grant select on public.season_rollover to authenticated;

-- ---------- where an aged-out player goes by default (internal) ----------
create or replace function public.rollover_default_placement(p_player uuid, p_club uuid)
returns table (team_id uuid, division_id uuid)
language sql stable security definer set search_path = public
as $$
  select t.id, t.division_id
    from public.team t
    join public.division d on d.id = t.division_id
    join public.player pl on pl.id = p_player
   where t.club_id = p_club
     and d.max_age is null
     and (
       (pl.gender = 'male' and d.gender_rule = 'male'
          and d.level = (select max(level) from public.division
                          where gender_rule = 'male' and max_age is null and level is not null))
       or (pl.gender = 'female' and d.gender_rule = 'female')
     )
   order by t.name
   limit 1
$$;
revoke execute on function public.rollover_default_placement(uuid, uuid) from public, anon, authenticated;

-- ---------- preview ----------
create or replace function public.rollover_preview(p_from uuid, p_to uuid)
returns table (
  registration_id uuid, player_id uuid, player_name text, photo_path text, dob date, gender text,
  club_id uuid, club_name text, team_name text, division_name text,
  outcome text, reason text, default_team_name text, default_division_name text
)
language sql stable security definer set search_path = public
as $$
  with me as (select public.my_role() as role, public.my_club_id() as club)
  select r.id, p.id, p.full_name, p.photo_path, p.dob, p.gender,
         c.id, c.name, t.name, d.name,
         case
           when ex.already then 'already_registered'
           when e.err is null then 'carry'
           else 'ageing_out'
         end,
         case when ex.already then null else e.err end,
         dt.name, dd.name
    from public.registration r
    join public.player   p on p.id = r.player_id
    join public.team     t on t.id = r.team_id
    join public.club     c on c.id = t.club_id
    join public.division d on d.id = r.division_id
    cross join lateral (select public.player_eligibility_error(r.player_id, r.division_id, p_to) as err) e
    cross join lateral (
      select exists (select 1 from public.registration x
                      where x.player_id = r.player_id and x.season_id = p_to and x.status = 'active') as already
    ) ex
    left join lateral (select * from public.rollover_default_placement(p.id, c.id)) dp
           on e.err is not null and not ex.already
    left join public.team     dt on dt.id = dp.team_id
    left join public.division dd on dd.id = dp.division_id
   where r.season_id = p_from and r.status = 'active'
     and ( (select role from me) = 'admin'
           or ((select role from me) = 'club_manager' and c.id = (select club from me)) )
   order by (e.err is null) , c.name, p.full_name
$$;

-- ---------- run ----------
create or replace function public.run_season_rollover(p_from uuid, p_to uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_from season%rowtype;
  v_to   season%rowtype;
  v_roll uuid;
  v_end  date;
  rec    record;
  v_err  text;
  v_new  uuid;
  v_def_team uuid;
  v_def_div  uuid;
  n_carried integer := 0;
  n_placed  integer := 0;
  n_unplaced integer := 0;
  n_skipped integer := 0;
  n_moves   integer := 0;
  n_susp    integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only administrators can run a season rollover.';
  end if;

  select * into v_from from public.season where id = p_from;
  select * into v_to   from public.season where id = p_to;
  if v_from.id is null or v_to.id is null then
    raise exception 'Season not found.';
  end if;
  if p_from = p_to then
    raise exception 'Choose two different seasons.';
  end if;
  if v_to.start_date <= v_from.start_date then
    raise exception 'The new season (%) must start after the season you are rolling over from (%).', v_to.name, v_from.name;
  end if;
  if exists (select 1 from public.season_rollover where to_season_id = p_to) then
    raise exception 'The rollover to season % has already been done.', v_to.name;
  end if;
  if v_to.cut_off_date is null and exists (
       select 1 from public.registration r join public.division d on d.id = r.division_id
        where r.season_id = p_from and r.status = 'active' and d.max_age is not null) then
    raise exception 'Season % has no age cut-off date. Set it on the Seasons page first.', v_to.name;
  end if;

  insert into public.season_rollover (from_season_id, to_season_id) values (p_from, p_to)
  returning id into v_roll;
  v_end := least(current_date, v_from.end_date);

  for rec in
    select r.id as reg_id, r.player_id, r.team_id, r.division_id, t.club_id
      from public.registration r
      join public.team t on t.id = r.team_id
     where r.season_id = p_from and r.status = 'active'
     order by r.player_id
  loop
    if exists (select 1 from public.registration x
                where x.player_id = rec.player_id and x.season_id = p_to and x.status = 'active') then
      insert into public.season_rollover_item (rollover_id, player_id, from_registration_id, outcome)
      values (v_roll, rec.player_id, rec.reg_id, 'skipped');
      n_skipped := n_skipped + 1;
      continue;
    end if;

    v_err := public.player_eligibility_error(rec.player_id, rec.division_id, p_to);
    update public.registration set status = 'ended', end_date = v_end where id = rec.reg_id;

    if v_err is null then
      insert into public.registration (player_id, team_id, division_id, season_id, status, start_date)
      values (rec.player_id, rec.team_id, rec.division_id, p_to, 'active', v_to.start_date)
      returning id into v_new;
      insert into public.season_rollover_item (rollover_id, player_id, from_registration_id, to_registration_id, outcome)
      values (v_roll, rec.player_id, rec.reg_id, v_new, 'carried');
      n_carried := n_carried + 1;
    else
      v_def_team := null; v_def_div := null;
      select dp.team_id, dp.division_id into v_def_team, v_def_div
        from public.rollover_default_placement(rec.player_id, rec.club_id) dp;
      if v_def_team is not null
         and public.player_eligibility_error(rec.player_id, v_def_div, p_to) is null then
        insert into public.registration (player_id, team_id, division_id, season_id, status, start_date)
        values (rec.player_id, v_def_team, v_def_div, p_to, 'active', v_to.start_date)
        returning id into v_new;
        insert into public.season_rollover_item (rollover_id, player_id, from_registration_id, to_registration_id, outcome)
        values (v_roll, rec.player_id, rec.reg_id, v_new, 'aged_out_placed');
        n_placed := n_placed + 1;
      else
        insert into public.season_rollover_item (rollover_id, player_id, from_registration_id, outcome)
        values (v_roll, rec.player_id, rec.reg_id, 'aged_out_unplaced');
        n_unplaced := n_unplaced + 1;
      end if;
    end if;
  end loop;

  -- unserved bans must not stay tied to last season's competition
  update public.suspension set competition_id = null
   where status = 'active' and competition_id is not null;
  get diagnostics n_susp = row_count;

  -- moves in progress started from registrations that have just ended
  update public.division_move
     set status = 'rejected',
         rejected_reason = 'The season rolled over. Please request this move again.'
   where status in ('requested','club_approved');
  get diagnostics n_moves = row_count;

  update public.season_rollover
     set carried = n_carried, aged_out_placed = n_placed, aged_out_unplaced = n_unplaced,
         skipped = n_skipped, moves_rejected = n_moves, suspensions_updated = n_susp
   where id = v_roll;

  return jsonb_build_object(
    'carried', n_carried, 'aged_out_placed', n_placed, 'aged_out_unplaced', n_unplaced,
    'skipped', n_skipped, 'moves_rejected', n_moves, 'suspensions_updated', n_susp);
end;
$$;

-- ---------- results after the run (scoped to the caller) ----------
create or replace function public.rollover_results(p_to uuid, p_only_changes boolean default true)
returns table (
  player_id uuid, player_name text, photo_path text, club_name text,
  from_team text, from_division text, to_team text, to_division text, outcome text
)
language sql stable security definer set search_path = public
as $$
  with me as (select public.my_role() as role, public.my_club_id() as club)
  select p.id, p.full_name, p.photo_path, c.name,
         ft.name, fd.name, tt.name, td.name, i.outcome
    from public.season_rollover ro
    join public.season_rollover_item i on i.rollover_id = ro.id
    join public.player p on p.id = i.player_id
    join public.registration fr on fr.id = i.from_registration_id
    join public.team ft on ft.id = fr.team_id
    join public.club c on c.id = ft.club_id
    join public.division fd on fd.id = fr.division_id
    left join public.registration tr on tr.id = i.to_registration_id
    left join public.team tt on tt.id = tr.team_id
    left join public.division td on td.id = tr.division_id
   where ro.to_season_id = p_to
     and (not p_only_changes or i.outcome not in ('carried','skipped'))
     and ( (select role from me) = 'admin'
           or ((select role from me) = 'club_manager' and c.id = (select club from me)) )
   order by (i.outcome = 'aged_out_unplaced') desc, c.name, p.full_name
$$;

revoke execute on function public.rollover_preview(uuid, uuid)        from public, anon;
revoke execute on function public.run_season_rollover(uuid, uuid)     from public, anon;
revoke execute on function public.rollover_results(uuid, boolean)     from public, anon;
grant  execute on function public.rollover_preview(uuid, uuid)        to authenticated;
grant  execute on function public.run_season_rollover(uuid, uuid)     to authenticated;
grant  execute on function public.rollover_results(uuid, boolean)     to authenticated;
