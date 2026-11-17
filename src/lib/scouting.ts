import type { PlayingPosition } from "@/lib/positions";

/** Pure logic for the scouting & eligibility profile (no database access here). */

export type Foot = "left" | "right" | "both";

/** Facts the player's club knows (administrators and the club's manager can edit). */
export interface DetailsRow {
  player_id: string;
  birthplace: string | null;
  secondary_position: PlayingPosition | null;
  preferred_foot: Foot | null;
  height_cm: number | null;
  weight_kg: number | null;
}

/** Judgement notes (administrators only). */
export interface NotesRow {
  player_id: string;
  system_fit_notes: string | null;
  captaincy: string | null;
  leadership_notes: string | null;
  big_game_notes: string | null;
  scouting_notes: string | null;
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

export const FOOT_LABEL: Record<Foot, string> = {
  left: "Left",
  right: "Right",
  both: "Both feet",
};

/**
 * Age-group eligibility by BIRTH YEAR, the way youth competitions are normally set:
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

export function ageGroupStatus(
  dobIso: string,
  today: Date = new Date(),
): AgeGroupStatus[] {
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
  today: Date = new Date(),
): Availability {
  const y1 = monthsAgo(12, today);
  const y2 = monthsAgo(24, today);
  const recent = injuries.filter((i) => i.injured_on >= y2 || !i.returned_on);
  const counts = new Map<string, number>();
  for (const i of injuries.filter((x) => x.injured_on >= y2)) {
    const area = (i.body_area ?? "").trim().toLowerCase();
    if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return {
    gamesTotal: gameDays.length,
    gamesLast12Months: gameDays.filter((d) => d >= y1).length,
    injuriesLast24Months: injuries.filter((i) => i.injured_on >= y2).length,
    gamesMissedLast24Months: recent.reduce(
      (s, i) => s + (i.games_missed ?? 0),
      0,
    ),
    currentlyInjured: injuries.find((i) => !i.returned_on) ?? null,
    recurringAreas: [...counts].filter(([, c]) => c >= 2).map(([a]) => a),
  };
}

/** Goals and cards per game (a simple stand-in: per-90 data needs minutes played, which are not recorded). */
export function perGame(games: number, n: number): string {
  return games > 0 ? (n / games).toFixed(2) : "–";
}

export interface DetailsDraft {
  birthplace: string;
  secondary_position: "" | PlayingPosition;
  preferred_foot: "" | Foot;
  height_cm: string;
  weight_kg: string;
}

export interface NotesDraft {
  system_fit_notes: string;
  captaincy: string;
  leadership_notes: string;
  big_game_notes: string;
  scouting_notes: string;
}

const s = (v: string | null | undefined) => v ?? "";
const n = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : String(v);
const text = (v: string) => (v.trim() === "" ? null : v.trim());

export function detailsDraft(r: DetailsRow | null): DetailsDraft {
  return {
    birthplace: s(r?.birthplace),
    secondary_position: r?.secondary_position ?? "",
    preferred_foot: r?.preferred_foot ?? "",
    height_cm: n(r?.height_cm),
    weight_kg: n(r?.weight_kg),
  };
}

export function notesDraft(r: NotesRow | null): NotesDraft {
  return {
    system_fit_notes: s(r?.system_fit_notes),
    captaincy: s(r?.captaincy),
    leadership_notes: s(r?.leadership_notes),
    big_game_notes: s(r?.big_game_notes),
    scouting_notes: s(r?.scouting_notes),
  };
}

function wholeNumber(
  v: string,
  label: string,
  min: number,
  max: number,
): number | null | string {
  if (v.trim() === "") return null;
  const x = Number(v);
  if (!Number.isInteger(x) || x < min || x > max)
    return `${label} must be a whole number from ${min} to ${max}.`;
  return x;
}

/** Turns the details form into a database row, or an error message for the first thing wrong. */
export function detailsRow(
  playerId: string,
  d: DetailsDraft,
): { row: DetailsRow } | { error: string } {
  const height = wholeNumber(d.height_cm, "Height", 100, 230);
  const weight = wholeNumber(d.weight_kg, "Weight", 25, 160);
  if (typeof height === "string") return { error: height };
  if (typeof weight === "string") return { error: weight };
  return {
    row: {
      player_id: playerId,
      birthplace: text(d.birthplace),
      secondary_position:
        d.secondary_position === "" ? null : d.secondary_position,
      preferred_foot: d.preferred_foot === "" ? null : d.preferred_foot,
      height_cm: height,
      weight_kg: weight,
    },
  };
}

export function notesRow(playerId: string, d: NotesDraft): NotesRow {
  return {
    player_id: playerId,
    system_fit_notes: text(d.system_fit_notes),
    captaincy: text(d.captaincy),
    leadership_notes: text(d.leadership_notes),
    big_game_notes: text(d.big_game_notes),
    scouting_notes: text(d.scouting_notes),
  };
}
