import { supabase } from '@/lib/supabaseClient';
import { one } from '@/lib/util';

/**
 * Player track record: which games a player's team played, and what the player
 * did in each one (goals, cards).
 *
 * Who can see what is decided by the database (Row Level Security), not here:
 * goals and cards only exist for PUBLISHED matches, and a club manager only sees
 * players registered to their own club.
 *
 * "Games" means: published, finished matches played by a team the player was
 * registered to on the match day. The system has no match-day squad list yet, so
 * a game where the player did not take the field (for example while serving a
 * ban) is still counted. A game where the player scored or was carded is always
 * counted, whatever the dates say.
 */

export type EventKind = 'goal' | 'yellow_card' | 'red_card' | 'substitution';

export interface RecordRegistration {
  id: string;
  team_id: string;
  team: string;
  start_date: string;
  end_date: string | null;
}

export interface RecordEvent {
  id: string;
  match_id: string;
  registration_id: string | null;
  event_type: EventKind;
  minute: number | null;
}

interface RecordMatch {
  id: string;
  kickoff_at: string;
  venue: string | null;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  away_team_id: string;
  home_name: string;
  away_name: string;
  competition: string;
}

export interface GameRecord {
  matchId: string;
  kickoffAt: string;
  competition: string;
  venue: string | null;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  /** The player's team in this game. */
  teamName: string;
  playerSide: 'home' | 'away';
  result: 'W' | 'D' | 'L' | null;
  /** Only this player's goals and cards, in minute order. */
  events: RecordEvent[];
}

export interface DisciplineTotals {
  goals: number;
  yellow: number;
  red: number;
}

const MATCH_SELECT =
  'id, kickoff_at, venue, home_score, away_score, home_team_id, away_team_id, ' +
  'home_team:home_team_id(name), away_team:away_team_id(name), competition:competition_id(name)';

/** The match day as YYYY-MM-DD in Papua New Guinea time (UTC+10), so late kick-offs stay on the right day. */
export function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Pacific/Port_Moresby' });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function countEvents(events: { event_type: EventKind }[]): DisciplineTotals {
  return {
    goals: events.filter((e) => e.event_type === 'goal').length,
    yellow: events.filter((e) => e.event_type === 'yellow_card').length,
    red: events.filter((e) => e.event_type === 'red_card').length,
  };
}

function toMatch(raw: unknown): RecordMatch {
  const r = raw as Record<string, unknown>;
  return {
    id: r.id as string,
    kickoff_at: r.kickoff_at as string,
    venue: (r.venue as string | null) ?? null,
    home_score: (r.home_score as number | null) ?? null,
    away_score: (r.away_score as number | null) ?? null,
    home_team_id: r.home_team_id as string,
    away_team_id: r.away_team_id as string,
    home_name: one(r.home_team as { name: string } | { name: string }[] | null)?.name ?? 'Home team',
    away_name: one(r.away_team as { name: string } | { name: string }[] | null)?.name ?? 'Away team',
    competition: one(r.competition as { name: string } | { name: string }[] | null)?.name ?? '',
  };
}

function buildGames(
  regs: RecordRegistration[],
  matches: RecordMatch[],
  events: RecordEvent[]
): GameRecord[] {
  const games: GameRecord[] = [];

  for (const m of matches) {
    const day = localDay(m.kickoff_at);
    const mine = events.filter((e) => e.match_id === m.id && e.event_type !== 'substitution');
    const eventRegIds = new Set(mine.map((e) => e.registration_id));

    const reg = regs.find(
      (r) =>
        (r.team_id === m.home_team_id || r.team_id === m.away_team_id) &&
        ((day >= r.start_date && (!r.end_date || day <= r.end_date)) || eventRegIds.has(r.id))
    );
    if (!reg) continue;

    const playerSide = reg.team_id === m.home_team_id ? 'home' : 'away';
    const forScore = playerSide === 'home' ? m.home_score : m.away_score;
    const againstScore = playerSide === 'home' ? m.away_score : m.home_score;
    let result: GameRecord['result'] = null;
    if (forScore !== null && againstScore !== null) {
      result = forScore > againstScore ? 'W' : forScore < againstScore ? 'L' : 'D';
    }

    games.push({
      matchId: m.id,
      kickoffAt: m.kickoff_at,
      competition: m.competition,
      venue: m.venue,
      homeName: m.home_name,
      awayName: m.away_name,
      homeScore: m.home_score,
      awayScore: m.away_score,
      teamName: reg.team,
      playerSide,
      result,
      events: [...mine].sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999)),
    });
  }

  return games.sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt));
}

/** Everything the profile needs: every game, plus goal and card totals. */
export async function fetchPlayerRecord(
  regs: RecordRegistration[]
): Promise<{ games: GameRecord[]; totals: DisciplineTotals; failed: boolean }> {
  const empty = { goals: 0, yellow: 0, red: 0 };
  if (regs.length === 0) return { games: [], totals: empty, failed: false };

  const regIds = regs.map((r) => r.id);
  const teamList = [...new Set(regs.map((r) => r.team_id))].join(',');

  const [evRes, matchRes] = await Promise.all([
    supabase
      .from('match_event')
      .select('id, match_id, registration_id, event_type, minute')
      .in('registration_id', regIds),
    supabase
      .from('match')
      .select(MATCH_SELECT)
      .eq('published', true)
      .in('status', ['completed', 'forfeit'])
      .or(`home_team_id.in.(${teamList}),away_team_id.in.(${teamList})`),
  ]);
  if (evRes.error || matchRes.error) return { games: [], totals: empty, failed: true };

  const events = (evRes.data ?? []) as RecordEvent[];
  const matches = ((matchRes.data ?? []) as unknown[]).map(toMatch);

  // A goal or card in a match that is not finished yet (still live) is still shown.
  const have = new Set(matches.map((m) => m.id));
  const missing = [...new Set(events.map((e) => e.match_id))].filter((id) => !have.has(id));
  if (missing.length > 0) {
    const extra = await supabase.from('match').select(MATCH_SELECT).in('id', missing);
    if (!extra.error) matches.push(...((extra.data ?? []) as unknown[]).map(toMatch));
  }

  return { games: buildGames(regs, matches, events), totals: countEvents(events), failed: false };
}

/** Goal and card totals for many players at once (used by the club roster). Null if it could not be loaded. */
export async function fetchDisciplineTotals(
  playerIds: string[]
): Promise<Record<string, DisciplineTotals> | null> {
  const totals: Record<string, DisciplineTotals> = {};
  for (const id of playerIds) totals[id] = { goals: 0, yellow: 0, red: 0 };
  if (playerIds.length === 0) return totals;

  // Every registration the player has had (a player who moved team still keeps their goals).
  const regResults = await Promise.all(
    chunk(playerIds, 80).map((ids) =>
      supabase.from('registration').select('id, player_id').in('player_id', ids)
    )
  );
  if (regResults.some((r) => r.error)) return null;
  const playerOfReg = new Map<string, string>();
  for (const res of regResults) {
    for (const row of (res.data ?? []) as { id: string; player_id: string }[]) {
      playerOfReg.set(row.id, row.player_id);
    }
  }

  const evResults = await Promise.all(
    chunk([...playerOfReg.keys()], 80).map((ids) =>
      supabase
        .from('match_event')
        .select('registration_id, event_type')
        .in('registration_id', ids)
    )
  );
  if (evResults.some((r) => r.error)) return null;
  for (const res of evResults) {
    for (const e of (res.data ?? []) as { registration_id: string | null; event_type: EventKind }[]) {
      const playerId = e.registration_id ? playerOfReg.get(e.registration_id) : undefined;
      const t = playerId ? totals[playerId] : undefined;
      if (!t) continue;
      if (e.event_type === 'goal') t.goals++;
      else if (e.event_type === 'yellow_card') t.yellow++;
      else if (e.event_type === 'red_card') t.red++;
    }
  }
  return totals;
}
