/*
# 021 — A result needs its goal scorers

Before this, a match could be saved as completed with a score of, say, 2-1 and no record of
who scored, and a goal could be saved with no player attached.

Two rules, enforced in the database so they apply to every screen:

  1. A goal must name the player who scored it (cards already had to).
  2. A match can only be marked COMPLETED when the goals recorded for each team add up to that
     team's score. Example: 2-1 needs two goals by home-team players and one by away-team
     players. If they do not match, the save is refused and the message says what is missing.

Not affected: forfeits (no goals are played), matches that are not being completed, and results
that were already completed before this migration (they are only checked if someone changes the
score or re-completes them). Changes made directly in the SQL Editor are not checked either,
so the sample-data scripts keep working.

Own goals cannot be recorded yet (there is no "own goal" event type), so a match that contains
one cannot be completed until that is added.

Safe to run more than once.
*/

-- ---------- 1. a goal must have a scorer ----------
create or replace function public.match_event_check()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  m public.match%rowtype;
  r public.registration%rowtype;
begin
  if new.registration_id is null then
    if new.event_type in ('yellow_card','red_card') then
      raise exception 'Choose the player who received the card.';
    end if;
    if new.event_type = 'goal' then
      raise exception 'Choose the player who scored the goal.';
    end if;
    return new;
  end if;
  select * into m from public.match where id = new.match_id;
  select * into r from public.registration where id = new.registration_id;
  if r.id is null or r.team_id not in (m.home_team_id, m.away_team_id) then
    raise exception 'That player is not on either team in this match.';
  end if;
  return new;
end;
$$;
revoke execute on function public.match_event_check() from public, anon, authenticated;

-- ---------- 2. completed means the scorers add up to the score ----------
create or replace function public.match_goals_match_score()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  home_goals integer;
  away_goals integer;
  hn text;
  an text;
  problems text[] := '{}';
begin
  if auth.uid() is null then
    return new;                       -- SQL Editor / scripts
  end if;
  if new.status <> 'completed' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'completed'
     and new.home_score is not distinct from old.home_score
     and new.away_score is not distinct from old.away_score then
    return new;                       -- already completed and the score is not changing
  end if;
  if new.home_score is null or new.away_score is null then
    return new;                       -- the existing "needs both scores" rule reports this
  end if;

  select count(*) filter (where r.team_id = new.home_team_id),
         count(*) filter (where r.team_id = new.away_team_id)
    into home_goals, away_goals
    from public.match_event e
    join public.registration r on r.id = e.registration_id
   where e.match_id = new.id and e.event_type = 'goal';

  select name into hn from public.team where id = new.home_team_id;
  select name into an from public.team where id = new.away_team_id;

  if home_goals <> new.home_score then
    problems := problems || format('%s: score is %s but %s goal%s recorded',
      coalesce(hn, 'Home'), new.home_score, home_goals, case when home_goals = 1 then ' is' else 's are' end);
  end if;
  if away_goals <> new.away_score then
    problems := problems || format('%s: score is %s but %s goal%s recorded',
      coalesce(an, 'Away'), new.away_score, away_goals, case when away_goals = 1 then ' is' else 's are' end);
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Record who scored before completing the match. % (use Goals and cards).',
      array_to_string(problems, '; ')
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.match_goals_match_score() from public, anon, authenticated;

drop trigger if exists match_goals_match_score_trg on public.match;
create trigger match_goals_match_score_trg
  before insert or update of status, home_score, away_score on public.match
  for each row execute function public.match_goals_match_score();
