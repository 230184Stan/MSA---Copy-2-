/*
# Phase 3 — Madang club rebrand + sample matches

## Purpose
Rebrands the two demo clubs from the national template to Madang-area clubs
and seeds published sample matches (3 completed, 2 scheduled) in the Men's A
2026 competition so Fixtures / Results / Standings pages show data.

## 1. Club rebrand (UPDATE, no rows dropped)
- "Port Moresby Rangers" -> "Madang Rangers"
- "Lae United"            -> "Coastal United"

## 2. Team rebrand (UPDATE)
- "Lae United FC" -> "Coastal United FC"

## 3. Sample matches in Men's A 2026
3 completed+published, 2 scheduled+published. Weekly cadence.

## 4. Security
No new tables/policies. All matches published=true so the existing
match_public_read_published policy exposes them.

## 5. Idempotency
Rebrands are UPDATE ... WHERE name='<old>' (no-op if already done).
Matches are guarded by NOT EXISTS so re-running is safe.
*/

-- 1. Rebrand clubs
UPDATE club SET name = 'Madang Rangers', founded = 1998, contact = 'rangers@example.org'
  WHERE name = 'Port Moresby Rangers';

UPDATE club SET name = 'Coastal United', founded = 2001, contact = 'united@example.org'
  WHERE name = 'Lae United';

-- 2. Rebrand team
UPDATE team SET name = 'Coastal United FC'
  WHERE name = 'Lae United FC';

-- 3. Seed matches (Rangers as home in slots 1,3,4,5; Coastal home in slot 2)
INSERT INTO match (competition_id, home_team_id, away_team_id, kickoff_at, venue, status, home_score, away_score, published)
SELECT '55555555-0000-0000-0000-000000000001',
       '44444444-0000-0000-0000-000000000001',
       '44444444-0000-0000-0000-000000000002',
       v.kickoff, v.venue, v.status, v.hs, v.away, true
FROM (VALUES
  ('2026-10-10 14:00:00+10'::timestamptz, 'Madang Sports Field 1', 'completed', 2, 1),
  ('2026-10-24 14:00:00+10'::timestamptz, 'Madang Sports Field 1', 'completed', 1, 1),
  ('2026-11-14 14:00:00+10'::timestamptz, 'Madang Sports Field 2', 'scheduled', NULL, NULL),
  ('2026-11-21 14:00:00+10'::timestamptz, 'Madang Sports Field 1', 'scheduled', NULL, NULL)
) AS v(kickoff, venue, status, hs, away)
WHERE NOT EXISTS (
  SELECT 1 FROM match m
  WHERE m.competition_id = '55555555-0000-0000-0000-000000000001'
    AND m.home_team_id   = '44444444-0000-0000-0000-000000000001'
    AND m.away_team_id   = '44444444-0000-0000-0000-000000000002'
    AND m.kickoff_at     = v.kickoff
);

-- Coastal United home game (round 2): 0 - 3
INSERT INTO match (competition_id, home_team_id, away_team_id, kickoff_at, venue, status, home_score, away_score, published)
SELECT '55555555-0000-0000-0000-000000000001',
       '44444444-0000-0000-0000-000000000002',
       '44444444-0000-0000-0000-000000000001',
       '2026-10-17 14:00:00+10'::timestamptz, 'Madang Sports Field 2', 'completed', 0, 3, true
WHERE NOT EXISTS (
  SELECT 1 FROM match m
  WHERE m.competition_id = '55555555-0000-0000-0000-000000000001'
    AND m.home_team_id   = '44444444-0000-0000-0000-000000000002'
    AND m.away_team_id   = '44444444-0000-0000-0000-000000000001'
    AND m.kickoff_at     = '2026-10-17 14:00:00+10'::timestamptz
);
