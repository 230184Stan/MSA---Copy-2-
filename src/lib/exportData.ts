import { supabase } from '@/lib/supabaseClient';
import { PHOTO_BUCKET } from '@/lib/photos';
import { chunk } from '@/lib/playerRecordCore';
import {
  README_TEXT,
  TABLE_ORDER,
  buildCsvs,
  photoFileName,
  type ExportBundle,
  type Row,
  type TableName,
} from '@/lib/exportBuild';
import { buildImportSql } from '@/lib/exportSql';

/**
 * Collects the data for an export and packs it into a zip.
 * What a person can export is decided by the database (Row Level Security and the
 * export_suspensions function), not here: a club manager only ever receives their own
 * club's players.
 */

const PAGE = 1000;

async function fetchAll(table: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read ${table}.`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Reads everything the signed-in person may see. clubId limits it to one club's players. */
export async function fetchBundle(opts: { clubId?: string | null; scopeLabel: string }): Promise<ExportBundle> {
  const [division, club, season, team, competition, player, registration, match, match_event] =
    await Promise.all([
      fetchAll('division'),
      fetchAll('club'),
      fetchAll('season'),
      fetchAll('team'),
      fetchAll('competition'),
      fetchAll('player'),
      fetchAll('registration'),
      fetchAll('match'),
      fetchAll('match_event'),
    ]);

  const teamClub = new Map(team.map((t) => [s(t.id), s(t.club_id)]));
  // Players of the chosen club: anyone registered to one of its teams.
  let players = player;
  if (opts.clubId) {
    const ids = new Set(
      registration.filter((r) => teamClub.get(s(r.team_id)) === opts.clubId).map((r) => s(r.player_id))
    );
    players = player.filter((p) => ids.has(s(p.id)));
  }
  const playerIds = new Set(players.map((p) => s(p.id)));
  const regs = registration.filter((r) => playerIds.has(s(r.player_id)));
  const regIds = new Set(regs.map((r) => s(r.id)));
  const events = match_event.filter((e) => regIds.has(s(e.registration_id)));

  // Matches: those their teams played, plus any a goal or card belongs to.
  const teamIds = new Set(regs.map((r) => s(r.team_id)));
  const eventMatchIds = new Set(events.map((e) => s(e.match_id)));
  const matches = match.filter(
    (m) =>
      teamIds.has(s(m.home_team_id)) || teamIds.has(s(m.away_team_id)) || eventMatchIds.has(s(m.id))
  );

  // Suspensions come from a function because the tables are not directly readable.
  const susp: { suspension: Row[]; suspension_match: Row[] } = { suspension: [], suspension_match: [] };
  const pidList = [...playerIds];
  for (const ids of chunk(pidList, 200)) {
    const { data, error } = await supabase.rpc('export_suspensions', { p_player_ids: ids });
    if (error) throw new Error('Could not read suspensions. Has migration 017 been run?');
    const d = data as { suspension?: Row[]; suspension_match?: Row[] } | null;
    susp.suspension.push(...(d?.suspension ?? []));
    susp.suspension_match.push(...(d?.suspension_match ?? []));
  }

  // Keep only the reference data that is actually used (everything for an unrestricted export).
  const allTeamIds = new Set<string>([
    ...teamIds,
    ...matches.flatMap((m) => [s(m.home_team_id), s(m.away_team_id)]),
  ]);
  const everything = !opts.clubId;
  const teams = everything ? team : team.filter((t) => allTeamIds.has(s(t.id)));
  const compIds = new Set(matches.map((m) => s(m.competition_id)));
  const comps = everything ? competition : competition.filter((c) => compIds.has(s(c.id)));
  const clubIds = new Set(teams.map((t) => s(t.club_id)));
  const divIds = new Set([
    ...teams.map((t) => s(t.division_id)),
    ...comps.map((c) => s(c.division_id)),
    ...regs.map((r) => s(r.division_id)),
  ]);
  const seasonIds = new Set([...comps.map((c) => s(c.season_id)), ...regs.map((r) => s(r.season_id))]);

  const tables: Record<TableName, Row[]> = {
    division: everything ? division : division.filter((d) => divIds.has(s(d.id))),
    club: everything ? club : club.filter((c) => clubIds.has(s(c.id))),
    season: everything ? season : season.filter((x) => seasonIds.has(s(x.id))),
    team: teams,
    competition: comps,
    player: players,
    registration: regs,
    match: matches,
    match_event: events,
    suspension: susp.suspension,
    suspension_match: susp.suspension_match,
  };
  for (const name of TABLE_ORDER) if (!tables[name]) tables[name] = [];

  return {
    format: 'msa-export',
    version: 1,
    exported_at: new Date().toISOString(),
    scope: opts.scopeLabel,
    tables,
  };
}

const enc = new TextEncoder();

/** Packs spreadsheets, import.sql, data.json, a README and (optionally) the photos into a zip. */
export async function buildZip(
  bundle: ExportBundle,
  withPhotos: boolean,
  onProgress?: (done: number, total: number) => void
): Promise<{ blob: Blob; photosSaved: number; photosFailed: number }> {
  const { zipSync } = await import('fflate');
  const csv = buildCsvs(bundle);
  const files: Record<string, Uint8Array> = {
    'README.txt': enc.encode(README_TEXT(bundle)),
    'players.csv': enc.encode(csv.players),
    'game_log.csv': enc.encode(csv.gameLog),
    'goals_and_cards.csv': enc.encode(csv.goalsAndCards),
    'suspensions.csv': enc.encode(csv.suspensions),
    'import.sql': enc.encode(buildImportSql(bundle)),
    'data.json': enc.encode(JSON.stringify(bundle, null, 2)),
  };

  let saved = 0;
  let failed = 0;
  if (withPhotos) {
    const withPhoto = bundle.tables.player.filter((p) => s(p.photo_path));
    let done = 0;
    for (const group of chunk(withPhoto, 4)) {
      await Promise.all(
        group.map(async (p) => {
          const name = photoFileName(p);
          const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(s(p.photo_path));
          if (error || !data || !name) failed++;
          else {
            files[name] = new Uint8Array(await data.arrayBuffer());
            saved++;
          }
          onProgress?.(++done, withPhoto.length);
        })
      );
    }
  }

  const zipped = zipSync(files, { level: 6 });
  return { blob: new Blob([zipped as BlobPart], { type: 'application/zip' }), photosSaved: saved, photosFailed: failed };
}
