import type { PlayingPosition } from '@/lib/positions';

/** Pure logic for the scouting & eligibility profile (no database access here). */

export type CapStatus = 'uncapped' | 'youth' | 'senior';
export type Foot = 'left' | 'right' | 'both';

export interface ScoutingRow {
  player_id: string;
  citizenships: string[];
  birthplace: string | null;
  heritage_notes: string | null;
  cap_status: CapStatus;
  senior_caps: number | null;
  youth_caps: number | null;
  cap_notes: string | null;
  secondary_position: PlayingPosition | null;
  preferred_foot: Foot | null;
  height_cm: number | null;
  weight_kg: number | null;
  system_fit_notes: string | null;
  captaincy: string | null;
  leadership_notes: string | null;
  big_game_notes: string | null;
  scouting_notes: string | null;
  updated_at?: string;
}

export interface InjuryRow {
  id: string;
  player_id: string;
  injury: string;
  body_area: string | null;
  injured_on: string;
  returned_on: string | null;
  games_missed: number | null;
  notes: string | null;
}

export const CAP_LABEL: Record<CapStatus, string> = {
  uncapped: 'Uncapped',
  youth: 'Youth international',
  senior: 'Senior international',
};

export const FOOT_LABEL: Record<Foot, string> = { left: 'Left', right: 'Right', both: 'Both feet' };

/**
 * Age-group eligibility by BIRTH YEAR, the way youth tournaments are normally set:
 * a player is eligible for an Under-N tournament held in a year if they were born in
 * (that year minus N) or later. So a player born in 2006 can play U-20 through 2026.
 * Exact rules differ per competition; the organiser's regulations are what counts.
 */
export const AGE_GROUPS = [17, 20, 23] as const;

export interface AgeGroupStatus {
  label: string;
  eligible: boolean;
  /** Last calendar year this player can be picked for this age group. */
  lastYear: number;
}

export function ageGroupStatus(dobIso: string, today: Date = new Date()): AgeGroupStatus[] {
  const birthYear = Number(dobIso.slice(0, 4));
  const year = today.getFullYear();
  return AGE_GROUPS.map((n) => ({
    label: `U-${n}`,
    lastYear: birthYear + n,
    eligible: year <= birthYear + n,
  }));
}

export interface Availability {
  gamesTotal: number;
  gamesLast12Months: number;
  injuriesLast24Months: number;
  gamesMissedLast24Months: number;
  currentlyInjured: InjuryRow | null;
  /** Soft-tissue and other injuries that keep coming back: body areas hit 2+ times in 24 months. */
  recurringAreas: string[];
}

function monthsAgo(n: number, today: Date): string {
  const d = new Date(today);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export function availability(
  gameDays: string[],
  injuries: InjuryRow[],
  today: Date = new Date()
): Availability {
  const y1 = monthsAgo(12, today);
  const y2 = monthsAgo(24, today);
  const recent = injuries.filter((i) => i.injured_on >= y2 || !i.returned_on);
  const counts = new Map<string, number>();
  for (const i of injuries.filter((x) => x.injured_on >= y2)) {
    const area = (i.body_area ?? '').trim().toLowerCase();
    if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return {
    gamesTotal: gameDays.length,
    gamesLast12Months: gameDays.filter((d) => d >= y1).length,
    injuriesLast24Months: injuries.filter((i) => i.injured_on >= y2).length,
    gamesMissedLast24Months: recent.reduce((s, i) => s + (i.games_missed ?? 0), 0),
    currentlyInjured: injuries.find((i) => !i.returned_on) ?? null,
    recurringAreas: [...counts].filter(([, c]) => c >= 2).map(([a]) => a),
  };
}

/** Goals and cards per game (a simple stand-in: per-90 data needs minutes played, which are not recorded). */
export function perGame(games: number, n: number): string {
  return games > 0 ? (n / games).toFixed(2) : '–';
}

export interface ScoutingDraft {
  citizenships: string;
  birthplace: string;
  heritage_notes: string;
  cap_status: CapStatus;
  senior_caps: string;
  youth_caps: string;
  cap_notes: string;
  secondary_position: '' | PlayingPosition;
  preferred_foot: '' | Foot;
  height_cm: string;
  weight_kg: string;
  system_fit_notes: string;
  captaincy: string;
  leadership_notes: string;
  big_game_notes: string;
  scouting_notes: string;
}

export function draftFromRow(r: ScoutingRow | null): ScoutingDraft {
  const s = (v: string | null | undefined) => v ?? '';
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  return {
    citizenships: (r?.citizenships ?? []).join(', '),
    birthplace: s(r?.birthplace),
    heritage_notes: s(r?.heritage_notes),
    cap_status: r?.cap_status ?? 'uncapped',
    senior_caps: n(r?.senior_caps),
    youth_caps: n(r?.youth_caps),
    cap_notes: s(r?.cap_notes),
    secondary_position: r?.secondary_position ?? '',
    preferred_foot: r?.preferred_foot ?? '',
    height_cm: n(r?.height_cm),
    weight_kg: n(r?.weight_kg),
    system_fit_notes: s(r?.system_fit_notes),
    captaincy: s(r?.captaincy),
    leadership_notes: s(r?.leadership_notes),
    big_game_notes: s(r?.big_game_notes),
    scouting_notes: s(r?.scouting_notes),
  };
}

/** Turns the form into a database row, or an error message for the first thing that is wrong. */
export function rowFromDraft(
  playerId: string,
  d: ScoutingDraft
): { row: Omit<ScoutingRow, 'updated_at'> } | { error: string } {
  const text = (v: string) => (v.trim() === '' ? null : v.trim());
  const int = (v: string, label: string, min: number, max: number): number | null | string => {
    if (v.trim() === '') return null;
    const x = Number(v);
    if (!Number.isInteger(x) || x < min || x > max) return `${label} must be a whole number from ${min} to ${max}.`;
    return x;
  };
  const senior = int(d.senior_caps, 'Senior caps', 0, 1000);
  const youth = int(d.youth_caps, 'Youth caps', 0, 1000);
  const height = int(d.height_cm, 'Height', 100, 230);
  const weight = int(d.weight_kg, 'Weight', 25, 160);
  for (const v of [senior, youth, height, weight]) if (typeof v === 'string') return { error: v };
  const citizenships: string[] = [];
  for (const c of d.citizenships.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) {
    if (!citizenships.some((x) => x.toLowerCase() === c.toLowerCase())) citizenships.push(c);
  }
  return {
    row: {
      player_id: playerId,
      citizenships,
      birthplace: text(d.birthplace),
      heritage_notes: text(d.heritage_notes),
      cap_status: d.cap_status,
      senior_caps: senior as number | null,
      youth_caps: youth as number | null,
      cap_notes: text(d.cap_notes),
      secondary_position: d.secondary_position === '' ? null : d.secondary_position,
      preferred_foot: d.preferred_foot === '' ? null : d.preferred_foot,
      height_cm: height as number | null,
      weight_kg: weight as number | null,
      system_fit_notes: text(d.system_fit_notes),
      captaincy: text(d.captaincy),
      leadership_notes: text(d.leadership_notes),
      big_game_notes: text(d.big_game_notes),
      scouting_notes: text(d.scouting_notes),
    },
  };
}
