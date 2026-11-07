/*
# Seed data: five divisions, current season, demo clubs/teams/competitions

1. Divisions (the five required)
   - Men's A   (gender male, no age limit, level 1 — top tier)
   - Men's B   (gender male, no age limit, level 2)
   - Men's C   (gender male, no age limit, level 3 — entry level)
   - Under 18  (gender any, max_age 17, no level — eligibility by date of birth)
   - Women's   (gender female, no age limit, no level — eligibility by gender)

   Note: Under 18 max_age is stored as 17, meaning "under 18". The eligibility
   check compares the player's age against season.cut_off_date. The cut-off date
   is stored on the season row, NOT hard-coded.

2. Season
   - "2026" season, Jan–Dec 2026, cut_off_date 2008-01-01 (a player must have
     been born on or after this date to qualify for Under 18 in the 2026 season).
   - Marked is_current = true.

3. Demo clubs & teams
   - Two clubs: "Port Moresby Rangers" and "Lae United".
   - One team per club in Men's A, for the Men's A 2026 competition.

4. Competitions
   - "Men's A 2026" competition (division Men's A + season 2026).
   - Competition entries for both demo teams.

5. Notes
   - Seeded rows use fixed UUIDs so later migrations can reference them by id.
   - No auth.users rows are seeded here (per Supabase guidance — never put
     user accounts in a migration). Admin/manager accounts are created in Phase 2.
*/

-- DIVISIONS (fixed UUIDs for stable reference)
insert into division (id, name, gender_rule, max_age, level) values
  ('11111111-0000-0000-0000-000000000001', 'Men''s A',  'male',   null, 1),
  ('11111111-0000-0000-0000-000000000002', 'Men''s B',  'male',   null, 2),
  ('11111111-0000-0000-0000-000000000003', 'Men''s C',  'male',   null, 3),
  ('11111111-0000-0000-0000-000000000004', 'Under 18', 'any',    17,   null),
  ('11111111-0000-0000-0000-000000000005', 'Women''s',  'female', null, null)
on conflict (name) do update set
  gender_rule = excluded.gender_rule,
  max_age     = excluded.max_age,
  level       = excluded.level;

-- SEASON 2026 (fixed UUID)
insert into season (id, name, start_date, end_date, cut_off_date, is_current) values
  ('22222222-0000-0000-0000-000000000001', '2026',
   date '2026-01-15', date '2026-12-15',
   date '2008-01-01', true)
on conflict (name) do update set
  start_date   = excluded.start_date,
  end_date     = excluded.end_date,
  cut_off_date = excluded.cut_off_date,
  is_current   = excluded.is_current;

-- DEMO CLUBS
insert into club (id, name, founded, contact) values
  ('33333333-0000-0000-0000-000000000001', 'Port Moresby Rangers', 1998, 'rangers@example.org'),
  ('33333333-0000-0000-0000-000000000002', 'Lae United',           2001, 'united@example.org')
on conflict (name) do update set
  founded = excluded.founded,
  contact = excluded.contact;

-- DEMO TEAMS (one per club in Men's A)
insert into team (id, club_id, name, division_id) values
  ('44444444-0000-0000-0000-000000000001',
   '33333333-0000-0000-0000-000000000001',
   'Rangers FC',
   '11111111-0000-0000-0000-000000000001'),
  ('44444444-0000-0000-0000-000000000002',
   '33333333-0000-0000-0000-000000000002',
   'Lae United FC',
   '11111111-0000-0000-0000-000000000001')
on conflict (club_id, name) do update set
  division_id = excluded.division_id;

-- COMPETITION: Men's A 2026
insert into competition (id, season_id, division_id, name) values
  ('55555555-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   'Men''s A 2026')
on conflict (season_id, division_id) do update set name = excluded.name;

-- COMPETITION ENTRIES
insert into competition_entry (competition_id, team_id) values
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001'),
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002')
on conflict (competition_id, team_id) do nothing;
