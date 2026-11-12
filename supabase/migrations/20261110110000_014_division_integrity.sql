/*
# 014 — Teams only play in their own division

## The rule
A team belongs to one division (team.division_id). From now on:
  - a team can only be ENTERED in a competition of its own division, and
  - a match can only be scheduled between two teams of that competition's division.
So a Men's B team can never appear in a Men's A fixture or table.

## How it is enforced
Two triggers that run for every write (the app, the API and the SQL editor alike):
  competition_entry : on insert, or when the team or competition changes
  match             : on insert, or when the competition or either team changes
They give a plain-language message, for example:
  "Coastal United FC is a Men's B team, so it cannot be entered in the Men's A 2026 competition."

## What it does NOT do
Rows that are ALREADY wrong are left alone, so applying this never fails and recording a score
on an old fixture still works. Run supabase/sample-data/4_fix_division_mismatches.sql to repair
the known case. Changing a team's division does not move it out of competitions it is already in,
so after changing a team's division, check its competition entries.
*/

create or replace function public.competition_entry_division_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_team      text;
  v_team_div  uuid;
  v_team_divn text;
  v_comp      text;
  v_comp_div  uuid;
  v_comp_divn text;
begin
  select t.name, t.division_id, d.name into v_team, v_team_div, v_team_divn
    from public.team t left join public.division d on d.id = t.division_id
   where t.id = new.team_id;
  select c.name, c.division_id, d.name into v_comp, v_comp_div, v_comp_divn
    from public.competition c join public.division d on d.id = c.division_id
   where c.id = new.competition_id;

  if v_team_div is null then
    raise exception '% has no division yet, so it cannot be entered in the % competition. Set its division first.', v_team, v_comp;
  end if;
  if v_team_div is distinct from v_comp_div then
    raise exception '% is a % team, so it cannot be entered in the % competition (%).', v_team, v_team_divn, v_comp, v_comp_divn;
  end if;
  return new;
end;
$$;
revoke execute on function public.competition_entry_division_guard() from public, anon, authenticated;

drop trigger if exists competition_entry_division_guard_trg on public.competition_entry;
create trigger competition_entry_division_guard_trg
  before insert or update of competition_id, team_id on public.competition_entry
  for each row execute function public.competition_entry_division_guard();

create or replace function public.match_division_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_comp      text;
  v_comp_div  uuid;
  rec         record;
begin
  select c.name, c.division_id into v_comp, v_comp_div
    from public.competition c
   where c.id = new.competition_id;

  for rec in
    select t.name, t.division_id, d.name as division_name
      from public.team t left join public.division d on d.id = t.division_id
     where t.id in (new.home_team_id, new.away_team_id)
  loop
    if rec.division_id is null then
      raise exception '% has no division yet, so it cannot play in the % competition. Set its division first.', rec.name, v_comp;
    end if;
    if rec.division_id is distinct from v_comp_div then
      raise exception '% is a % team, but this match is in %. Teams can only play in their own division.', rec.name, rec.division_name, v_comp;
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function public.match_division_guard() from public, anon, authenticated;

drop trigger if exists match_division_guard_trg on public.match;
create trigger match_division_guard_trg
  before insert or update of competition_id, home_team_id, away_team_id on public.match
  for each row execute function public.match_division_guard();
