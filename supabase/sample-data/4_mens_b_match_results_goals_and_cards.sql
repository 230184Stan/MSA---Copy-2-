-- Adds the match-day detail for the 2 completed Men's B games: who scored, and who got cards.
-- Run AFTER scripts 1, 2 and 3.
--
--   Oct 3  Rangers FC B 2 - 1 Coastal United FC
--     Goals : Tony Stark 23', Steve Rogers 67' (Rangers) / Barry Allen 41' (Coastal)
--     Yellow: Bruce Banner 35' (Rangers), Guy Gardner 52' (Coastal)
--     Red   : Jason Todd 78' (Coastal)   -> 1-match ban, already SERVED in the Oct 17 game
--
--   Oct 17 Coastal United FC 1 - 1 Rangers FC B
--     Goals : Victor Stone 12' (Coastal) / Peter Parker 58' (Rangers)
--     Yellow: Tony Stark 44' (Rangers), Oliver Queen 71' (Coastal)
--     Red   : Thor Odinson 85' (Rangers) -> 1-match ban, still SERVING (next game is Nov 21)
--
-- Any OTHER completed game that has no events yet (for example the Men's A games from the
-- earlier sample data) gets goals that add up to its final score, plus one yellow card for
-- the home side, using players already registered to those teams. A team with no registered
-- players is skipped with a message.
--
-- The goals add up to each game's final score. The red-card suspensions are created by the
-- database itself, exactly as they would be when a referee records the card.
-- Safe to run more than once: if these games already have events, nothing is added.
do $$
declare
  v_comp   uuid;
  v_m1     uuid;
  v_m2     uuid;
  v_added  integer := 0;
  v_extra  integer := 0;
  rec      record;
  gm       record;
  v_regs   uuid[];
  v_side   text;
  v_goals  integer;
  v_team   uuid;
  i        integer;
begin
  select c.id into v_comp
    from competition c
    join season s on s.id = c.season_id and s.is_current
    join division d on d.id = c.division_id and d.name = 'Men''s B';
  if v_comp is null then
    raise exception 'The Men''s B competition was not found. Run script 3 first.';
  end if;

  select id into v_m1 from match
   where competition_id = v_comp and kickoff_at = timestamptz '2026-10-03 15:00+10' and status = 'completed';
  select id into v_m2 from match
   where competition_id = v_comp and kickoff_at = timestamptz '2026-10-17 15:00+10' and status = 'completed';
  if v_m1 is null or v_m2 is null then
    raise exception 'The two completed Men''s B games (3 Oct and 17 Oct) were not found. Run script 3 first.';
  end if;

  if exists (select 1 from match_event where match_id in (v_m1, v_m2)) then
    raise notice 'The Men''s B games already have goals and cards recorded, so they were left as they are.';
  else
  -- One insert per event, in kick-off order, so the suspension rules run just like real entry.
  for rec in
    select ev.match_id, ev.player_name, ev.event_type, ev.minute, r.id as registration_id
      from (values
        (v_m1, 'Tony Stark',    'goal',        23),
        (v_m1, 'Barry Allen',   'goal',        41),
        (v_m1, 'Steve Rogers',  'goal',        67),
        (v_m1, 'Bruce Banner',  'yellow_card', 35),
        (v_m1, 'Guy Gardner',   'yellow_card', 52),
        (v_m1, 'Jason Todd',    'red_card',    78),
        (v_m2, 'Victor Stone',  'goal',        12),
        (v_m2, 'Peter Parker',  'goal',        58),
        (v_m2, 'Tony Stark',    'yellow_card', 44),
        (v_m2, 'Oliver Queen',  'yellow_card', 71),
        (v_m2, 'Thor Odinson',  'red_card',    85)
      ) as ev(match_id, player_name, event_type, minute)
      join match m on m.id = ev.match_id
      left join player p on p.full_name = ev.player_name
      left join registration r
        on r.player_id = p.id
       and r.status = 'active'
       and r.team_id in (m.home_team_id, m.away_team_id)
     order by m.kickoff_at, ev.minute
  loop
    if rec.registration_id is null then
      raise exception '% is not an active player on either team in that game. Run scripts 1 and 2 first.', rec.player_name;
    end if;
    insert into match_event (match_id, registration_id, event_type, minute)
    values (rec.match_id, rec.registration_id, rec.event_type, rec.minute);
    v_added := v_added + 1;
  end loop;
  raise notice 'Added % goals and cards across the 2 completed Men''s B games.', v_added;
  end if;

  -- Other completed games with no events yet: goals that match the score, plus a home yellow.
  for gm in
    select id, home_team_id, away_team_id, home_score, away_score, kickoff_at
      from match
     where status in ('completed', 'forfeit')
       and published
       and home_score is not null and away_score is not null
       and id not in (v_m1, v_m2)
       and not exists (select 1 from match_event e where e.match_id = match.id)
     order by kickoff_at
  loop
    foreach v_side in array array['home', 'away'] loop
      v_team  := case when v_side = 'home' then gm.home_team_id else gm.away_team_id end;
      v_goals := case when v_side = 'home' then gm.home_score else gm.away_score end;

      select array_agg(r.id order by p.full_name) into v_regs
        from registration r join player p on p.id = r.player_id
       where r.team_id = v_team and r.status = 'active';

      if v_regs is null then
        raise notice 'A team in the game on % has no registered players, so its goals and cards were skipped.',
          to_char(gm.kickoff_at at time zone 'Pacific/Port_Moresby', 'DD Mon YYYY');
        continue;
      end if;

      for i in 1 .. v_goals loop
        insert into match_event (match_id, registration_id, event_type, minute)
        values (gm.id, v_regs[1 + ((i * 3 + extract(day from gm.kickoff_at)::int) % array_length(v_regs, 1))],
                'goal', least(10 + i * 22, 89));
        v_extra := v_extra + 1;
      end loop;

      if v_side = 'home' then
        insert into match_event (match_id, registration_id, event_type, minute)
        values (gm.id, v_regs[1 + ((extract(day from gm.kickoff_at)::int * 2 + 1) % array_length(v_regs, 1))],
                'yellow_card', 55);
        v_extra := v_extra + 1;
      end if;
    end loop;
  end loop;

  if v_extra > 0 then
    raise notice 'Added % goals and cards to the other completed games.', v_extra;
  end if;
end $$;
