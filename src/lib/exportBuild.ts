// Turns loaded data into the files of an export. Pure: no database or browser access.
import {
  buildGames,
  countEvents,
  localDay,
  type EventKind,
  type GameRecord,
  type RecordEvent,
  type RecordMatch,
  type RecordRegistration,
} from '@/lib/playerRecordCore';

export type Row = Record<string, unknown>;

export const TABLE_ORDER = [
  'division',
  'club',
  'season',
  'team',
  'competition',
  'player',
  'registration',
  'match',
  'match_event',
  'suspension',
  'suspension_match',
] as const;
export type TableName = (typeof TABLE_ORDER)[number];

export interface ExportBundle {
  format: 'msa-export';
  version: 1;
  exported_at: string;
  scope: string;
  tables: Record<TableName, Row[]>;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// ---------- CSV ----------

/** One CSV cell. Quoted when needed; text a spreadsheet could treat as a formula gets a leading apostrophe. */
export function csvCell(v: unknown): string {
  let s = str(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** CSV text with a byte-order mark so Excel reads accents and names correctly. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------- helpers ----------

function byId(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((r) => [str(r.id), r]));
}

const EVENT_LABEL: Record<string, string> = {
  goal: 'Goal',
  yellow_card: 'Yellow card',
  red_card: 'Red card',
  substitution: 'Substitution',
};
const REASON_LABEL: Record<string, string> = {
  red_card: 'Red card',
  yellow_accumulation: 'Yellow card accumulation',
  admin: 'Set by an administrator',
};
const RESULT_LABEL: Record<string, string> = { W: 'Win', D: 'Draw', L: 'Loss' };

/** A file-safe name for a player's photo inside the export. */
export function photoFileName(player: Row): string | null {
  const path = str(player.photo_path);
  if (!path) return null;
  const ext = (path.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const name = str(player.full_name)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40);
  return `photos/${name || 'player'}_${str(player.id).slice(0, 8)}.${ext}`;
}

interface Model {
  players: Row[];
  teams: Map<string, Row>;
  clubs: Map<string, Row>;
  divisions: Map<string, Row>;
  seasons: Map<string, Row>;
  competitions: Map<string, Row>;
  regsByPlayer: Map<string, Row[]>;
  regById: Map<string, Row>;
  matchById: Map<string, Row>;
  eventsByPlayer: Map<string, RecordEvent[]>;
  playerOfReg: Map<string, string>;
  servedByBan: Map<string, number>;
  gamesByPlayer: Map<string, GameRecord[]>;
  suspensionsByPlayer: Map<string, Row[]>;
}

function toRecordMatch(m: Row, teams: Map<string, Row>, comps: Map<string, Row>): RecordMatch {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: str(m.id),
    kickoff_at: str(m.kickoff_at),
    venue: m.venue ? str(m.venue) : null,
    home_score: num(m.home_score),
    away_score: num(m.away_score),
    home_team_id: str(m.home_team_id),
    away_team_id: str(m.away_team_id),
    home_name: str(teams.get(str(m.home_team_id))?.name) || 'Home team',
    away_name: str(teams.get(str(m.away_team_id))?.name) || 'Away team',
    competition: str(comps.get(str(m.competition_id))?.name),
  };
}

function buildModel(b: ExportBundle): Model {
  const t = b.tables;
  const teams = byId(t.team);
  const comps = byId(t.competition);
  const regById = byId(t.registration);

  const regsByPlayer = new Map<string, Row[]>();
  const playerOfReg = new Map<string, string>();
  for (const r of t.registration) {
    const pid = str(r.player_id);
    playerOfReg.set(str(r.id), pid);
    if (!regsByPlayer.has(pid)) regsByPlayer.set(pid, []);
    regsByPlayer.get(pid)!.push(r);
  }

  const eventsByPlayer = new Map<string, RecordEvent[]>();
  for (const e of t.match_event) {
    const pid = playerOfReg.get(str(e.registration_id));
    if (!pid) continue;
    if (!eventsByPlayer.has(pid)) eventsByPlayer.set(pid, []);
    eventsByPlayer.get(pid)!.push({
      id: str(e.id),
      match_id: str(e.match_id),
      registration_id: str(e.registration_id),
      event_type: str(e.event_type) as EventKind,
      minute: e.minute === null || e.minute === undefined ? null : Number(e.minute),
    });
  }

  // Games a player took part in are worked out exactly as on the player's profile page.
  const records = t.match
    .filter((m) => ['completed', 'forfeit'].includes(str(m.status)) || eventsExist(t.match_event, str(m.id)))
    .map((m) => toRecordMatch(m, teams, comps));
  const gamesByPlayer = new Map<string, GameRecord[]>();
  for (const p of t.player) {
    const pid = str(p.id);
    const regs: RecordRegistration[] = (regsByPlayer.get(pid) ?? []).map((r) => ({
      id: str(r.id),
      team_id: str(r.team_id),
      team: str(teams.get(str(r.team_id))?.name),
      start_date: str(r.start_date),
      end_date: r.end_date ? str(r.end_date) : null,
    }));
    gamesByPlayer.set(pid, buildGames(regs, records, eventsByPlayer.get(pid) ?? []));
  }

  const servedByBan = new Map<string, number>();
  for (const sm of t.suspension_match) {
    const k = str(sm.suspension_id);
    servedByBan.set(k, (servedByBan.get(k) ?? 0) + 1);
  }
  const suspensionsByPlayer = new Map<string, Row[]>();
  for (const s of t.suspension) {
    const pid = str(s.player_id);
    if (!suspensionsByPlayer.has(pid)) suspensionsByPlayer.set(pid, []);
    suspensionsByPlayer.get(pid)!.push(s);
  }

  return {
    players: [...t.player].sort((a, b) => str(a.full_name).localeCompare(str(b.full_name))),
    teams,
    clubs: byId(t.club),
    divisions: byId(t.division),
    seasons: byId(t.season),
    competitions: comps,
    regsByPlayer,
    regById,
    matchById: byId(t.match),
    eventsByPlayer,
    playerOfReg,
    servedByBan,
    gamesByPlayer,
    suspensionsByPlayer,
  };
}

function eventsExist(events: Row[], matchId: string): boolean {
  return events.some((e) => str(e.match_id) === matchId);
}

/** The registration that describes where a player is now: active/suspended first, then the latest. */
function currentReg(regs: Row[]): Row | undefined {
  const live = regs.filter((r) => ['active', 'suspended'].includes(str(r.status)));
  const pool = live.length ? live : regs;
  return [...pool].sort((a, b) => str(b.start_date).localeCompare(str(a.start_date)))[0];
}

function age(dob: string, on: Date): number | '' {
  const d = new Date(dob + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  let a = on.getFullYear() - d.getFullYear();
  const m = on.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < d.getDate())) a--;
  return a;
}

// ---------- the four spreadsheets ----------

/** One spreadsheet: used for both the CSV files and the formatted Excel workbook. */
export interface Sheet {
  name: string;
  header: string[];
  rows: unknown[][];
  /** Columns holding an ISO date (yyyy-mm-dd), so Excel can show them as real dates. */
  dateCols: number[];
}

export interface CsvFiles {
  players: string;
  gameLog: string;
  goalsAndCards: string;
  suspensions: string;
}

export function buildCsvs(b: ExportBundle): CsvFiles {
  const [players, gameLog, goalsAndCards, suspensions] = buildSheets(b).map((s) => toCsv(s.header, s.rows));
  return { players, gameLog, goalsAndCards, suspensions };
}

export function buildSheets(b: ExportBundle): Sheet[] {
  const m = buildModel(b);
  const now = new Date(b.exported_at);

  // 1. One row per player
  const players: Sheet = {
    name: 'Players',
    dateCols: [1],
    header: [
      'Name', 'Date of birth', 'Age', 'Gender', 'Position', 'Club', 'Team', 'Division',
      'Season', 'Registration status', 'Games played', 'Wins', 'Draws', 'Losses', 'Goals',
      'Yellow cards', 'Red cards', 'Suspensions (total)', 'Matches left on current ban', 'Photo file',
      'Player ID',
    ],
    rows: m.players.map((p) => {
      const pid = str(p.id);
      const reg = currentReg(m.regsByPlayer.get(pid) ?? []);
      const team = reg ? m.teams.get(str(reg.team_id)) : undefined;
      const club = team ? m.clubs.get(str(team.club_id)) : undefined;
      const games = m.gamesByPlayer.get(pid) ?? [];
      const totals = countEvents(m.eventsByPlayer.get(pid) ?? []);
      const bans = m.suspensionsByPlayer.get(pid) ?? [];
      const left = bans
        .filter((s) => str(s.status) === 'active')
        .reduce((mx, s) => Math.max(mx, Number(s.matches_banned) - (m.servedByBan.get(str(s.id)) ?? 0)), 0);
      return [
        p.full_name,
        p.dob,
        age(str(p.dob), now),
        str(p.gender) === 'female' ? 'Female' : 'Male',
        str(p.playing_position) ? str(p.playing_position)[0].toUpperCase() + str(p.playing_position).slice(1) : '',
        club?.name ?? '',
        team?.name ?? '',
        reg ? m.divisions.get(str(reg.division_id))?.name ?? '' : '',
        reg ? m.seasons.get(str(reg.season_id))?.name ?? '' : '',
        reg ? reg.status : '',
        games.length,
        games.filter((g) => g.result === 'W').length,
        games.filter((g) => g.result === 'D').length,
        games.filter((g) => g.result === 'L').length,
        totals.goals,
        totals.yellow,
        totals.red,
        bans.length,
        left,
        photoFileName(p) ?? '',
        pid,
      ];
    }),
  };

  // 2. One row per player per game
  const gameRows: unknown[][] = [];
  for (const p of m.players) {
    for (const g of m.gamesByPlayer.get(str(p.id)) ?? []) {
      const mins = (k: EventKind) =>
        g.events.filter((e) => e.event_type === k).map((e) => (e.minute === null ? '?' : `${e.minute}'`)).join(' ');
      const c = countEvents(g.events);
      gameRows.push([
        p.full_name, g.teamName, localDay(g.kickoffAt), g.competition, g.homeName, g.awayName,
        g.homeScore === null || g.awayScore === null ? '' : `${g.homeScore}-${g.awayScore}`,
        g.result ? RESULT_LABEL[g.result] : '', c.goals, mins('goal'), c.yellow, mins('yellow_card'),
        c.red, mins('red_card'), g.venue ?? '', str(p.id),
      ]);
    }
  }
  const gameLog: Sheet = {
    name: 'Game log',
    dateCols: [2],
    header: ['Player', 'Team', 'Date', 'Competition', 'Home team', 'Away team', 'Score', 'Result', 'Goals',
     'Goal minutes', 'Yellow cards', 'Yellow minutes', 'Red cards', 'Red minutes', 'Venue', 'Player ID'],
    rows: gameRows,
  };

  // 3. One row per goal / card / substitution
  const evRows: unknown[][] = [];
  for (const p of m.players) {
    for (const e of m.eventsByPlayer.get(str(p.id)) ?? []) {
      const mt = m.matchById.get(e.match_id);
      const reg = m.regById.get(str(e.registration_id));
      evRows.push([
        p.full_name,
        reg ? m.teams.get(str(reg.team_id))?.name ?? '' : '',
        mt ? localDay(str(mt.kickoff_at)) : '',
        mt ? m.competitions.get(str(mt.competition_id))?.name ?? '' : '',
        mt ? m.teams.get(str(mt.home_team_id))?.name ?? '' : '',
        mt ? m.teams.get(str(mt.away_team_id))?.name ?? '' : '',
        EVENT_LABEL[e.event_type] ?? e.event_type,
        e.minute ?? '',
        str(p.id),
      ]);
    }
  }
  evRows.sort((a, b) => str(a[0]).localeCompare(str(b[0])) || str(a[2]).localeCompare(str(b[2])) || Number(a[7]) - Number(b[7]));
  const goalsAndCards: Sheet = {
    name: 'Goals and cards',
    dateCols: [2],
    header: ['Player', 'Team', 'Date', 'Competition', 'Home team', 'Away team', 'Event', 'Minute', 'Player ID'],
    rows: evRows,
  };

  // 4. One row per suspension
  const susRows: unknown[][] = [];
  for (const p of m.players) {
    for (const s of m.suspensionsByPlayer.get(str(p.id)) ?? []) {
      const served = m.servedByBan.get(str(s.id)) ?? 0;
      const src = s.source_match_id ? m.matchById.get(str(s.source_match_id)) : undefined;
      susRows.push([
        p.full_name,
        REASON_LABEL[str(s.reason)] ?? str(s.reason),
        s.competition_id ? m.competitions.get(str(s.competition_id))?.name ?? '' : 'Any competition',
        s.matches_banned,
        served,
        Math.max(Number(s.matches_banned) - served, 0),
        str(s.status) === 'active' ? 'Serving' : str(s.status) === 'served' ? 'Served' : 'Cancelled',
        src
          ? `${m.teams.get(str(src.home_team_id))?.name ?? ''} v ${m.teams.get(str(src.away_team_id))?.name ?? ''}, ${localDay(str(src.kickoff_at))}`
          : '',
        s.notes ?? '',
        localDay(str(s.created_at)),
        str(p.id),
      ]);
    }
  }
  const suspensions: Sheet = {
    name: 'Suspensions',
    dateCols: [9],
    header: ['Player', 'Reason', 'Competition', 'Matches banned', 'Matches served', 'Matches left', 'Status',
     'Card shown in', 'Notes', 'Date recorded', 'Player ID'],
    rows: susRows,
  };

  return [players, gameLog, goalsAndCards, suspensions];
}

export function countSummary(b: ExportBundle) {
  const m = buildModel(b);
  return {
    players: b.tables.player.length,
    registrations: b.tables.registration.length,
    games: [...m.gamesByPlayer.values()].reduce((n, g) => n + g.length, 0),
    events: b.tables.match_event.length,
    suspensions: b.tables.suspension.length,
    photos: b.tables.player.filter((p) => str(p.photo_path)).length,
  };
}

export const README_TEXT = (b: ExportBundle) => `MSA data export
===============
Made on:  ${b.exported_at}
Scope:    ${b.scope}

SPREADSHEETS (open in Excel, Google Sheets, LibreOffice)
  MSA_player_records.xlsx   The formatted workbook: a Summary sheet, then Players, Game log,
                       Goals and cards, Suspensions. Open this one to read or print.
  csv/                 The same four tables as plain CSV, for importing into other software.
                       players.csv: details, team, games, goals, cards, bans.
                       game_log.csv: one row per player per game.
                       goals_and_cards.csv: one row per goal / card / substitution.
                       suspensions.csv: one row per ban, with matches served and left.

FOR ANOTHER DATABASE
  import.sql           Loads all of this into another MSA database. Open that database's
                       SQL editor (Supabase: SQL Editor > New query), paste the whole file
                       and run it. It needs migrations 001 to 017 and the "postgres" role.
                       It is safe to run twice: it matches existing clubs, teams, players and
                       matches instead of duplicating them, and tells you what it added.
  data.json            The same data as plain JSON, for any other system or script.
                       Tables are in dependency order and use the original ids.

PHOTOS
  photos/              Each player's photo, named like Name_1234abcd.jpg. The SQL import does
                       not carry photos (they live in file storage): upload them on each
                       player's profile page in the new system.

NOTES
  - Only finished, published matches count as games, as in the app.
  - A club manager's export contains only players registered to their own club.
  - These files contain personal details. Store and share them carefully.
`;
