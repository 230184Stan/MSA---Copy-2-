/** Helpers for announcements (kept free of React and the database so they are easy to test). */

export type Audience = 'public' | 'staff';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  pinned: boolean;
  publish_at: string;
  expires_at: string | null;
}

export type AnnouncementState = 'live' | 'scheduled' | 'expired';

export function announcementState(a: Pick<Announcement, 'publish_at' | 'expires_at'>, now = new Date()): AnnouncementState {
  if (new Date(a.publish_at) > now) return 'scheduled';
  if (a.expires_at && new Date(a.expires_at) <= now) return 'expired';
  return 'live';
}

/** "2026-11-18T09:30" in the viewer's own time zone, for a datetime-local input. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type TextPart = { text: string; href?: string };

/** Splits text into plain pieces and web links, so links can be made clickable without HTML. */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    let url = m[0];
    const idx = m.index ?? 0;
    // Trailing punctuation belongs to the sentence, not the link.
    const trail = /[.,;:!?)\]]+$/.exec(url)?.[0] ?? '';
    if (trail) url = url.slice(0, -trail.length);
    if (idx > last) parts.push({ text: text.slice(last, idx) });
    parts.push({ text: url, href: url });
    last = idx + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function sortForDisplay<T extends Pick<Announcement, 'pinned' | 'publish_at'>>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.publish_at.localeCompare(a.publish_at)
  );
}
