import { supabase } from '@/lib/supabaseClient';
import { one } from '@/lib/util';
import {
  buildGames,
  chunk,
  countEvents,
  type DisciplineTotals,
  type EventKind,
  type GameRecord,
  type RecordEvent,
  type RecordMatch,
  type RecordRegistration,
} from '@/lib/playerRecordCore';

export { localDay } from '@/lib/playerRecordCore';
export type {
  DisciplineTotals,
  EventKind,
  GameRecord,
  RecordEvent,
  RecordRegistration,
} from '@/lib/playerRecordCore';

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

const MATCH_SELECT =
  'id, kickoff_at, venue, home_score, away_score, home_team_id, away_team_id, ' +
  'home_team:home_team_id(name), away_team:away_team_id(name), competition:competition_id(name)';

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
