-- Completes the Coastal United FC Men's B squad (Justice League civilian names).
-- 1) makes sure the team itself is recorded as Men's B (it may still carry an older division)
-- 2) adds 14 players to the 4 you already have, all registered for the current season.
-- Safe to run more than once: players that already exist are skipped.
do $$
declare
  v_team     uuid;
  v_team_div uuid;
  v_old_name text;
  v_mens_b   uuid;
  v_season   uuid;
  v_added    integer;
begin
  select id, division_id into v_team, v_team_div from team where name = 'Coastal United FC';
  if v_team is null then
    raise exception 'The team "Coastal United FC" was not found.';
  end if;

  select id into v_mens_b from division where name = 'Men''s B';
  if v_mens_b is null then
    raise exception 'The division "Men''s B" was not found.';
  end if;

  select id into v_season from season where is_current;
  if v_season is null then
    raise exception 'No current season is set.';
  end if;

  if v_team_div is distinct from v_mens_b then
    select name into v_old_name from division where id = v_team_div;
    update team set division_id = v_mens_b where id = v_team;
    raise notice 'Coastal United FC was recorded as % and is now Men''s B.', coalesce(v_old_name, 'having no division');
  end if;

  with squad(full_name, dob) as (
    values
      ('Barry Allen',   date '2006-03-14'),
      ('Victor Stone',  date '2006-05-30'),
      ('John Stewart',  date '2006-07-19'),
      ('Oliver Queen',  date '2006-09-02'),
      ('Ray Palmer',    date '2006-10-25'),
      ('Billy Batson',  date '2006-11-11'),
      ('Wally West',    date '2007-01-08'),
      ('Kyle Rayner',   date '2007-02-27'),
      ('Guy Gardner',   date '2007-04-04'),
      ('Dick Grayson',  date '2007-05-21'),
      ('Jason Todd',    date '2006-06-16'),
      ('Tim Drake',     date '2007-07-13'),
      ('Conner Kent',   date '2007-08-09'),
      ('Carter Hall',   date '2006-04-02')
  ),
  new_players as (
    insert into player (full_name, dob, gender)
    select s.full_name, s.dob, 'male'
      from squad s
     where not exists (select 1 from player p where p.full_name = s.full_name)
    returning id
  )
  insert into registration (player_id, team_id, division_id, season_id, status)
  select np.id, v_team, v_mens_b, v_season, 'active'
    from new_players np;

  get diagnostics v_added = row_count;
  raise notice 'Added % players to Coastal United FC (Men''s B).', v_added;
end $$;
