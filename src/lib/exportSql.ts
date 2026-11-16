// Builds import.sql: one script that loads an export into another MSA database.
// Pure: no database or browser access.
import type { ExportBundle } from '@/lib/exportBuild';

const HEAD = `-- MSA data import
-- Made from an export of __SCOPE__ on __DATE__.
--
-- HOW TO USE: open the SQL editor of the database you want to load this into
-- (Supabase: SQL Editor > New query), paste this whole file and run it.
--
-- Needs: an MSA database with migrations 001 to 017, and the database owner role
-- ("postgres" in the Supabase SQL Editor).
--
-- It does NOT overwrite or delete anything. It matches what already exists:
--   clubs, seasons and divisions by name; teams by club + name; competitions by season + division;
--   players by name + date of birth; matches by competition, teams and kick-off time.
-- Anything that is not there yet is added. Running it twice adds nothing the second time.
-- If a player already has a different active team in this database, the imported registration is
-- added as "ended" so their history is kept without breaking the one-active-team rule.
-- Photos are not included (they live in file storage); upload them on each player's profile.
-- When it finishes it prints a summary of what it added.

create or replace function pg_temp.msa_free_id(t text, i uuid) returns uuid
language plpgsql as $f$
declare taken boolean;
begin
  execute format('select exists (select 1 from %s where id = $1)', t) into taken using i;
  return case when taken then gen_random_uuid() else i end;
end
$f$;

do $import$
declare
  v jsonb := $msa_export$__JSON__$msa_export$::jsonb;
`;

const BODY = `  r record;
  x uuid;
  nid uuid;
  a uuid; b uuid; c uuid; d uuid;
  n_player_new int := 0; n_player_found int := 0;
  n_team_new int := 0; n_club_new int := 0;
  n_reg_new int := 0; n_reg_ended int := 0; n_reg_skipped int := 0;
  n_match_new int := 0; n_event_new int := 0; n_susp_new int := 0;
begin
  begin
    set local session_replication_role = replica;  -- loads history without re-running the match rules
  exception when insufficient_privilege then
    raise exception 'This import must be run by the database owner (the "postgres" role in the Supabase SQL Editor).';
  end;

  create temp table m_division (src uuid primary key, dst uuid not null) on commit drop;
  create temp table m_club (src uuid primary key, dst uuid not null) on commit drop;
  create temp table m_season (src uuid primary key, dst uuid not null) on commit drop;
  create temp table m_team (src uuid primary key, dst uuid not null) on commit drop;
  create temp table m_comp (src uuid primary key, dst uuid not null) on commit drop;
  create temp table m_player (src uuid primary key, dst uuid not null) on commit drop;
  create temp table m_reg (src uuid primary key, dst uuid not null) on commit drop;
  create temp table m_match (src uuid primary key, dst uuid not null) on commit drop;
  create temp table m_event (src uuid primary key, dst uuid not null) on commit drop;
  create temp table m_susp (src uuid primary key, dst uuid not null) on commit drop;

  -- divisions
  for r in select * from jsonb_populate_recordset(null::public.division, v->'tables'->'division') loop
    select t.id into x from public.division t where t.name = r.name;
    if x is null then
      nid := pg_temp.msa_free_id('public.division', r.id);
      insert into public.division (id, name, gender_rule, max_age, level)
      values (nid, r.name, r.gender_rule, r.max_age, r.level);
      x := nid;
    end if;
    insert into m_division values (r.id, x);
  end loop;

  -- clubs
  for r in select * from jsonb_populate_recordset(null::public.club, v->'tables'->'club') loop
    select t.id into x from public.club t where t.name = r.name;
    if x is null then
      nid := pg_temp.msa_free_id('public.club', r.id);
      insert into public.club (id, name, founded, contact) values (nid, r.name, r.founded, r.contact);
      x := nid; n_club_new := n_club_new + 1;
    end if;
    insert into m_club values (r.id, x);
  end loop;

  -- seasons (never made "current" here: choose that yourself on the Seasons page)
  for r in select * from jsonb_populate_recordset(null::public.season, v->'tables'->'season') loop
    select t.id into x from public.season t where t.name = r.name;
    if x is null then
      nid := pg_temp.msa_free_id('public.season', r.id);
      insert into public.season (id, name, start_date, end_date, cut_off_date, is_current)
      values (nid, r.name, r.start_date, r.end_date, r.cut_off_date, false);
      x := nid;
    end if;
    insert into m_season values (r.id, x);
  end loop;

  -- teams
  for r in select * from jsonb_populate_recordset(null::public.team, v->'tables'->'team') loop
    select m.dst into a from m_club m where m.src = r.club_id;
    select m.dst into b from m_division m where m.src = r.division_id;
    continue when a is null;
    select t.id into x from public.team t where t.club_id = a and t.name = r.name;
    if x is null then
      nid := pg_temp.msa_free_id('public.team', r.id);
      insert into public.team (id, club_id, name, division_id) values (nid, a, r.name, b);
      x := nid; n_team_new := n_team_new + 1;
    end if;
    insert into m_team values (r.id, x);
  end loop;

  -- competitions
  for r in select * from jsonb_populate_recordset(null::public.competition, v->'tables'->'competition') loop
    select m.dst into a from m_season m where m.src = r.season_id;
    select m.dst into b from m_division m where m.src = r.division_id;
    continue when a is null or b is null;
    select t.id into x from public.competition t where t.season_id = a and t.division_id = b;
    if x is null then
      nid := pg_temp.msa_free_id('public.competition', r.id);
      insert into public.competition (id, season_id, division_id, name) values (nid, a, b, r.name);
      x := nid;
    end if;
    insert into m_comp values (r.id, x);
  end loop;

  -- players
  for r in select * from jsonb_populate_recordset(null::public.player, v->'tables'->'player') loop
    select t.id into x from public.player t
     where lower(t.full_name) = lower(r.full_name) and t.dob = r.dob limit 1;
    if x is null then
      nid := pg_temp.msa_free_id('public.player', r.id);
      insert into public.player (id, full_name, dob, gender, playing_position)
      values (nid, r.full_name, r.dob, r.gender, r.playing_position);
      x := nid; n_player_new := n_player_new + 1;
    else
      n_player_found := n_player_found + 1;
      update public.player set playing_position = coalesce(playing_position, r.playing_position) where id = x;
    end if;
    insert into m_player values (r.id, x);
  end loop;

  -- registrations
  for r in select * from jsonb_populate_recordset(null::public.registration, v->'tables'->'registration') loop
    select m.dst into a from m_player m where m.src = r.player_id;
    select m.dst into b from m_team m where m.src = r.team_id;
    select m.dst into c from m_division m where m.src = r.division_id;
    select m.dst into d from m_season m where m.src = r.season_id;
    if a is null or b is null or c is null or d is null then
      n_reg_skipped := n_reg_skipped + 1;
      continue;
    end if;
    select t.id into x from public.registration t
     where t.player_id = a and t.team_id = b and t.season_id = d and t.start_date = r.start_date;
    if x is null then
      nid := pg_temp.msa_free_id('public.registration', r.id);
      begin
        insert into public.registration (id, player_id, team_id, division_id, season_id, status, start_date, end_date)
        values (nid, a, b, c, d, r.status, r.start_date, r.end_date);
        n_reg_new := n_reg_new + 1;
      exception when unique_violation then
        insert into public.registration (id, player_id, team_id, division_id, season_id, status, start_date, end_date)
        values (nid, a, b, c, d, 'ended', r.start_date, coalesce(r.end_date, r.start_date));
        n_reg_ended := n_reg_ended + 1;
      end;
      x := nid;
    end if;
    insert into m_reg values (r.id, x);
  end loop;

  -- matches (referees are not carried over: they are accounts of the other system)
  for r in select * from jsonb_populate_recordset(null::public.match, v->'tables'->'match') loop
    select m.dst into a from m_comp m where m.src = r.competition_id;
    select m.dst into b from m_team m where m.src = r.home_team_id;
    select m.dst into c from m_team m where m.src = r.away_team_id;
    continue when a is null or b is null or c is null;
    select t.id into x from public.match t
     where t.competition_id = a and t.home_team_id = b and t.away_team_id = c and t.kickoff_at = r.kickoff_at;
    if x is null then
      nid := pg_temp.msa_free_id('public.match', r.id);
      insert into public.match (id, competition_id, home_team_id, away_team_id, kickoff_at, venue, status, home_score, away_score, published)
      values (nid, a, b, c, r.kickoff_at, r.venue, r.status, r.home_score, r.away_score, r.published);
      x := nid; n_match_new := n_match_new + 1;
    end if;
    insert into m_match values (r.id, x);
  end loop;

  -- goals, cards and substitutions
  for r in select * from jsonb_populate_recordset(null::public.match_event, v->'tables'->'match_event') loop
    select m.dst into a from m_match m where m.src = r.match_id;
    select m.dst into b from m_reg m where m.src = r.registration_id;
    continue when a is null or b is null;
    select t.id into x from public.match_event t
     where t.match_id = a and t.registration_id = b and t.event_type = r.event_type
       and t.minute is not distinct from r.minute
       and t.id not in (select dst from m_event);
    if x is null then
      nid := pg_temp.msa_free_id('public.match_event', r.id);
      insert into public.match_event (id, match_id, registration_id, event_type, minute)
      values (nid, a, b, r.event_type, r.minute);
      x := nid; n_event_new := n_event_new + 1;
    end if;
    insert into m_event values (r.id, x);
  end loop;

  -- suspensions and the matches already served
  for r in select * from jsonb_populate_recordset(null::public.suspension, v->'tables'->'suspension') loop
    select m.dst into a from m_player m where m.src = r.player_id;
    continue when a is null;
    select m.dst into b from m_comp m where m.src = r.competition_id;
    select m.dst into c from m_match m where m.src = r.source_match_id;
    select m.dst into d from m_event m where m.src = r.source_event_id;
    select t.id into x from public.suspension t
     where t.player_id = a and t.reason = r.reason and t.matches_banned = r.matches_banned
       and t.created_at = r.created_at and t.competition_id is not distinct from b;
    if x is null then
      nid := pg_temp.msa_free_id('public.suspension', r.id);
      insert into public.suspension (id, player_id, competition_id, source_match_id, source_event_id, reason, matches_banned, status, notes, created_at)
      values (nid, a, b, c, d, r.reason, r.matches_banned, r.status, r.notes, r.created_at);
      x := nid; n_susp_new := n_susp_new + 1;
    end if;
    insert into m_susp values (r.id, x);
  end loop;

  for r in select * from jsonb_populate_recordset(null::public.suspension_match, v->'tables'->'suspension_match') loop
    select m.dst into a from m_susp m where m.src = r.suspension_id;
    select m.dst into b from m_match m where m.src = r.match_id;
    continue when a is null or b is null;
    insert into public.suspension_match (suspension_id, match_id) values (a, b) on conflict do nothing;
  end loop;

  raise notice 'Import finished. Added: % player(s) (% already existed), % club(s), % team(s), % registration(s) (% as ended), % match(es), % goal/card event(s), % suspension(s). Registrations skipped: %.',
    n_player_new, n_player_found, n_club_new, n_team_new, n_reg_new + n_reg_ended, n_reg_ended,
    n_match_new, n_event_new, n_susp_new, n_reg_skipped;
end
$import$;
`;

/** The whole import.sql text for a bundle. */
export function buildImportSql(b: ExportBundle): string {
  // "$" is written as \\u0024 inside the JSON so nothing in the data can close the quoting.
  const json = JSON.stringify(b).replace(/\$/g, '\\u0024');
  return (
    HEAD.replace('__SCOPE__', () => b.scope.replace(/[\r\n]+/g, ' '))
      .replace('__DATE__', () => b.exported_at)
      .replace('__JSON__', () => json) +
    BODY
  );
}
