-- Sets up the Men's B competition for the current season with the two Men's B teams
-- (Madang Rangers' B team and Coastal United FC), plus 4 fixtures: 2 played, 2 coming up.
-- Safe to run more than once: nothing is created twice.
do $$
declare
  v_season  uuid;
  v_season_name text;
  v_mens_b  uuid;
  v_comp    uuid;
  v_rangers uuid;
  v_coastal uuid;
begin
  select id, name into v_season, v_season_name from season where is_current;
  if v_season is null then
    raise exception 'No current season is set.';
  end if;

  select id into v_mens_b from division where name = 'Men''s B';
  if v_mens_b is null then
    raise exception 'The division "Men''s B" was not found.';
  end if;

  select t.id into v_rangers
    from team t join club c on c.id = t.club_id
   where c.name = 'Madang Rangers' and t.division_id = v_mens_b
   order by t.name limit 1;
  if v_rangers is null then
    raise exception 'Madang Rangers has no Men''s B team yet. Run the Avengers squad script first.';
  end if;

  select id into v_coastal from team where name = 'Coastal United FC' and division_id = v_mens_b;
  if v_coastal is null then
    raise exception 'Coastal United FC is not a Men''s B team yet. Run the Justice League squad script first.';
  end if;

  insert into competition (season_id, division_id, name)
  values (v_season, v_mens_b, 'Men''s B ' || v_season_name)
  on conflict (season_id, division_id) do nothing;
  select id into v_comp from competition where season_id = v_season and division_id = v_mens_b;

  insert into competition_entry (competition_id, team_id)
  values (v_comp, v_rangers), (v_comp, v_coastal)
  on conflict (competition_id, team_id) do nothing;

  insert into match (competition_id, home_team_id, away_team_id, kickoff_at, venue, status, home_score, away_score, published)
  select v_comp, f.home_id, f.away_id, f.kickoff, f.venue, f.status, f.hs, f.as_, true
    from (values
      (v_rangers, v_coastal, timestamptz '2026-10-03 15:00+10', 'Rangers home ground', 'completed', 2, 1),
      (v_coastal, v_rangers, timestamptz '2026-10-17 15:00+10', 'Coastal home ground', 'completed', 1, 1),
      (v_rangers, v_coastal, timestamptz '2026-11-21 15:00+10', 'Rangers home ground', 'scheduled', null::int, null::int),
      (v_coastal, v_rangers, timestamptz '2026-12-05 15:00+10', 'Coastal home ground', 'scheduled', null::int, null::int)
    ) as f(home_id, away_id, kickoff, venue, status, hs, as_)
   where not exists (
     select 1 from match m
      where m.competition_id = v_comp and m.home_team_id = f.home_id
        and m.away_team_id = f.away_id and m.kickoff_at = f.kickoff
   );

  raise notice 'Men''s B % is ready: % matches in the competition.',
    v_season_name, (select count(*) from match where competition_id = v_comp);
end $$;
