export interface DivisionInfo {
  id: string;
  name: string;
  level: number | null;
}

export interface SeasonInfo {
  id: string;
  name: string;
  is_current: boolean;
}

/** Men's A, B, C by level first; divisions without a level (Under 18, Women's) after, by name. */
export function compareDivisions(
  a: Pick<DivisionInfo, 'level' | 'name'>,
  b: Pick<DivisionInfo, 'level' | 'name'>
): number {
  return (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name);
}

/** Current season first, then newest name first. Duplicates (by id) are removed. */
export function sortSeasons(seasons: SeasonInfo[]): SeasonInfo[] {
  const unique = new Map<string, SeasonInfo>();
  for (const s of seasons) unique.set(s.id, s);
  return [...unique.values()].sort(
    (a, b) => Number(b.is_current) - Number(a.is_current) || b.name.localeCompare(a.name)
  );
}

/** Distinct divisions, in display order. */
export function sortDivisions(divisions: DivisionInfo[]): DivisionInfo[] {
  const unique = new Map<string, DivisionInfo>();
  for (const d of divisions) unique.set(d.id, d);
  return [...unique.values()].sort(compareDivisions);
}
