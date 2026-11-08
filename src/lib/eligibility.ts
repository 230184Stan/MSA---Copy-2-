import type { Division, Season } from '@/lib/types';

export interface EligibilityPlayer {
  dob: string; // ISO date, YYYY-MM-DD
  gender: 'male' | 'female';
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Checks whether a player may be registered to a division for a season.
 * Returns null if eligible, otherwise a plain-language reason.
 *
 * Rules (kept in sync with the database trigger in migration 007):
 *  - division.gender_rule 'male' / 'female' must match the player's gender.
 *  - division.max_age (e.g. Under 18) requires the player to be born ON OR AFTER
 *    the season's cut_off_date. The cut-off is stored on the season, never hard-coded.
 */
export function checkEligibility(
  player: EligibilityPlayer,
  division: Pick<Division, 'name' | 'gender_rule' | 'max_age'>,
  season: Pick<Season, 'name' | 'cut_off_date'>
): string | null {
  if (division.gender_rule === 'male' && player.gender !== 'male') {
    return `${division.name} is for male players only.`;
  }
  if (division.gender_rule === 'female' && player.gender !== 'female') {
    return `${division.name} is for female players only.`;
  }
  if (division.max_age != null) {
    if (!season.cut_off_date) {
      return `The ${season.name} season has no age cut-off date. Ask an admin to set one.`;
    }
    if (player.dob < season.cut_off_date) {
      return `${division.name} is for players born on or after ${formatDate(
        season.cut_off_date
      )}. This player is too old.`;
    }
  }
  return null;
}
