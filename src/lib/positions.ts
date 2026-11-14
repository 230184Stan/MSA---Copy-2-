export type PlayingPosition = 'goalkeeper' | 'defender' | 'midfielder' | 'forward';

export const POSITIONS: { value: PlayingPosition; label: string; short: string }[] = [
  { value: 'goalkeeper', label: 'Goalkeeper', short: 'GK' },
  { value: 'defender', label: 'Defender', short: 'DF' },
  { value: 'midfielder', label: 'Midfielder', short: 'MF' },
  { value: 'forward', label: 'Forward', short: 'FW' },
];

export function positionLabel(p: PlayingPosition | null | undefined): string | null {
  return POSITIONS.find((x) => x.value === p)?.label ?? null;
}

/** Sort order for a squad list: goalkeepers first, then defenders, midfielders, forwards, then unset. */
export function positionRank(p: PlayingPosition | null | undefined): number {
  const i = POSITIONS.findIndex((x) => x.value === p);
  return i === -1 ? POSITIONS.length : i;
}
