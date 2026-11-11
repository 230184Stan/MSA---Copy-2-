-- Builds the Madang Rangers Men's B squad (Avengers civilian names), 18 players.
-- * Uses the club's existing Men's B team if it has one; otherwise creates "Rangers FC B".
--   It never changes any existing team (the Men's A team "Rangers FC" is left alone).
-- * All players are male, born Feb 2006 - Sep 2007 (ages 19-20), registered for the current season.
-- Safe to run more than once: players that already exist are skipped.
do $$
declare
  v_club   uuid;
  v_team   uuid;
  v_mens_b uuid;
  v_season uuid;
  v_added  integer;
begin
  select id into v_club from club where name = 'Madang Rangers';
  if v_club is null then
    raise exception 'The club "Madang Rangers" was not found. Clubs in the database: %',
      (select string_agg(name, ', ' order by name) from club);
  end if;

  select id into v_mens_b from division where name = 'Men''s B';
  if v_mens_b is null then
    raise exception 'The division "Men''s B" was not found.';
  end if;

  select id into v_season from season where is_current;
  if v_season is null then
    raise exception 'No current season is set.';
  end if;

  select id into v_team from team
   where club_id = v_club and division_id = v_mens_b
   order by name limit 1;

  if v_team is null then
    insert into team (club_id, name, division_id)
    values (v_club, 'Rangers FC B', v_mens_b)
    returning id into v_team;
    raise notice 'Created the team "Rangers FC B" (Men''s B) for Madang Rangers.';
  end if;

  with squad(full_name, dob) as (
    values
      ('Steve Rogers',    date '2006-02-12'),
      ('James Rhodes',    date '2006-03-06'),
      ('Tony Stark',      date '2006-04-09'),
      ('Bruce Banner',    date '2006-05-21'),
      ('Thor Odinson',    date '2006-07-04'),
      ('Clint Barton',    date '2006-08-18'),
      ('Sam Wilson',      date '2006-09-29'),
      ('James Barnes',    date '2006-10-13'),
      ('Scott Lang',      date '2006-11-27'),
      ('Luke Cage',       date '2006-12-09'),
      ('Peter Parker',    date '2007-01-15'),
      ('Stephen Strange', date '2007-02-02'),
      ('Pietro Maximoff', date '2007-03-19'),
      ('Hank Pym',        date '2007-04-24'),
      ('Peter Quill',     date '2007-05-08'),
      ('Simon Williams',  date '2007-06-30'),
      ('Billy Kaplan',    date '2007-08-22'),
      ('T''Challa',       date '2007-09-11')
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
  raise notice 'Added % players to the Madang Rangers Men''s B team.', v_added;
end $$;
