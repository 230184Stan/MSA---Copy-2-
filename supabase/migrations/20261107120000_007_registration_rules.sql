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
