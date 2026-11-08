/** Supabase returns a joined row as an object or a one-item array; normalise to one object. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Turn a Supabase/Postgres error into a short message a non-technical person can act on. */
export function errMsg(
  e: { code?: string; message?: string } | null | undefined,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (!e) return fallback;
  if (e.code === '23505') return 'That already exists.';
  if (e.code === '23503') return 'That is still linked to other records, so it cannot be removed.';
  if (e.code === '42501' || /row-level security|permission denied/i.test(e.message ?? '')) {
    return 'You do not have permission to do that.';
  }
  if (/failed to fetch|network/i.test(e.message ?? '')) {
    return 'No connection. Check your internet and try again.';
  }
  return e.message || fallback;
}

export function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
