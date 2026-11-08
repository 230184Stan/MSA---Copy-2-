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
