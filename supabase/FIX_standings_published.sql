-- Run this once in Supabase SQL Editor if you already applied the earlier setup.
-- Makes standings ignore unpublished matches.

create or replace view public.standings
with (security_invoker = true) as
with results as (
  select competition_id, home_team_id as team_id,
         home_score as gf, away_score as ga
    from public.match
   where status in ('completed','forfeit')
     and published = true
     and home_score is not null and away_score is not null
  union all
  select competition_id, away_team_id,
         away_score, home_score
    from public.match
   where status in ('completed','forfeit')
     and published = true
     and home_score is not null and away_score is not null
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
