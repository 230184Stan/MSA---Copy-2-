// Pure logic for a player's record (no database access), shared by the profile page and the data export.

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

export interface RecordMatch {
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

/** The match day as YYYY-MM-DD in Papua New Guinea time (UTC+10), so late kick-offs stay on the right day. */
export function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Pacific/Port_Moresby' });
}

export function chunk<T>(items: T[], size: number): T[][] {
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

export function buildGames(
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

