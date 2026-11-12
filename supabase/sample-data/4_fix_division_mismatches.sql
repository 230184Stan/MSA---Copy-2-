-- Finds and repairs entries and matches that sit in the WRONG DIVISION.
--
-- For every competition entry or match that uses a team from another division, this swaps in the
-- SAME CLUB's team from the competition's own division (for example "Coastal United FC", a Men's B
-- team, in a Men's A fixture becomes "Coastal United A"). Nothing is created or deleted except:
--   * an entry that would become a duplicate (the right team is already entered) is removed;
--   * anything this script cannot fix safely (the club has no team in that division, or both sides
--     of a match would become the same team) is LEFT ALONE and listed in the messages below.
-- Players, squads, results and scores are not touched. Safe to run more than once.
do $$
declare
  r          record;
  v_new      uuid;
  v_home     uuid;
  v_away     uuid;
  n_entry_moved   integer := 0;
  n_entry_dropped integer := 0;
  n_match_moved   integer := 0;
  n_unresolved    integer := 0;
  n_left          integer;
begin
  -- 1) competition entries
  for r in
    select e.id as entry_id, e.competition_id, e.team_id,
           t.name as team_name, t.club_id, c.name as comp_name, c.division_id as comp_div
      from competition_entry e
      join competition c on c.id = e.competition_id
      join team t on t.id = e.team_id
     where t.division_id is distinct from c.division_id
  loop
    select t2.id into v_new from team t2
     where t2.club_id = r.club_id and t2.division_id = r.comp_div
     order by t2.name limit 1;
    if v_new is null then
      raise notice 'NOT FIXED: % has no team in the division of "%", so its entry was left alone.', r.team_name, r.comp_name;
      n_unresolved := n_unresolved + 1;
    elsif exists (select 1 from competition_entry x where x.competition_id = r.competition_id and x.team_id = v_new) then
      delete from competition_entry where id = r.entry_id;
      n_entry_dropped := n_entry_dropped + 1;
    else
      update competition_entry set team_id = v_new where id = r.entry_id;
      n_entry_moved := n_entry_moved + 1;
    end if;
  end loop;

  -- 2) matches (both sides are replaced in ONE update so the division rule never sees a half-fixed row)
  for r in
    select m.id as match_id, m.home_team_id, m.away_team_id, c.name as comp_name, c.division_id as comp_div,
           ht.name as home_name, ht.club_id as home_club, ht.division_id as home_div,
           at.name as away_name, at.club_id as away_club, at.division_id as away_div
      from match m
      join competition c on c.id = m.competition_id
      join team ht on ht.id = m.home_team_id
      join team at on at.id = m.away_team_id
     where ht.division_id is distinct from c.division_id
        or at.division_id is distinct from c.division_id
  loop
    v_home := r.home_team_id;
    v_away := r.away_team_id;
    if r.home_div is distinct from r.comp_div then
      select t2.id into v_home from team t2
       where t2.club_id = r.home_club and t2.division_id = r.comp_div order by t2.name limit 1;
    end if;
    if r.away_div is distinct from r.comp_div then
      select t2.id into v_away from team t2
       where t2.club_id = r.away_club and t2.division_id = r.comp_div order by t2.name limit 1;
    end if;

    if v_home is null or v_away is null or v_home = v_away then
      raise notice 'NOT FIXED: the match % v % in "%" could not be repaired automatically.', r.home_name, r.away_name, r.comp_name;
      n_unresolved := n_unresolved + 1;
    else
      update match set home_team_id = v_home, away_team_id = v_away where id = r.match_id;
      n_match_moved := n_match_moved + 1;
    end if;
  end loop;

  raise notice 'Entries re-pointed: %, duplicate entries removed: %, matches re-pointed: %, left for you: %.',
    n_entry_moved, n_entry_dropped, n_match_moved, n_unresolved;

  -- 3) final check
  select count(*) into n_left from (
    select e.id from competition_entry e
      join competition c on c.id = e.competition_id join team t on t.id = e.team_id
     where t.division_id is distinct from c.division_id
    union all
    select m.id from match m
      join competition c on c.id = m.competition_id
      join team t on t.id in (m.home_team_id, m.away_team_id)
     where t.division_id is distinct from c.division_id
  ) x;
  raise notice 'Entries or matches still in the wrong division: %', n_left;
end $$;
