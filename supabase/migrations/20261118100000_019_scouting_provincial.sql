/*
# 019 — Scouting profile: remove national-team fields

The association runs a provincial competition, so the national-team items added in 018 are
not needed: citizenships, heritage, cap status, senior/youth caps and cap notes are removed
from player_scouting. Everything else (birthplace, position, foot, size, system fit,
intangibles, notes, injuries) stays.

Any text already typed into those removed columns is deleted. Safe to run more than once.
*/
alter table public.player_scouting
  drop column if exists citizenships,
  drop column if exists heritage_notes,
  drop column if exists cap_status,
  drop column if exists senior_caps,
  drop column if exists youth_caps,
  drop column if exists cap_notes;
