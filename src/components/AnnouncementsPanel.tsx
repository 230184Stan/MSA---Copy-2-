import { useEffect, useState } from 'react';
import { Megaphone, Pin } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { linkify, sortForDisplay, type Announcement } from '@/lib/announcements';

const LONG = 280; // characters before a message is folded behind "Read more"

function Body({ text }: { text: string }) {
  return (
    <p className="text-sm text-pitch-800 whitespace-pre-line break-words">
      {linkify(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="underline text-pitch-700 break-all">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </p>
  );
}

/**
 * Announcements that are live right now and meant for the viewer. The database decides what a
 * person may see (public notices for everyone; staff notices for signed-in staff), so this just
 * asks for "live" ones. Shows nothing at all when there are none or they cannot be loaded.
 */
export default function AnnouncementsPanel() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const now = new Date().toISOString();
    supabase
      .from('announcement')
      .select('id, title, body, audience, pinned, publish_at, expires_at')
      .lte('publish_at', now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('pinned', { ascending: false })
      .order('publish_at', { ascending: false })
      .limit(6)
      .then(({ data, error }) => {
        if (!cancelled && !error) setItems(sortForDisplay((data ?? []) as Announcement[]));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <section aria-label="Announcements" className="space-y-3">
      <h2 className="font-display font-bold text-xl flex items-center gap-2">
        <Megaphone className="w-5 h-5 text-gold-500" aria-hidden /> Announcements
      </h2>
      <ul className="space-y-3">
        {items.map((a) => {
          const long = a.body.length > LONG;
          const expanded = open[a.id] || !long;
          const text = expanded ? a.body : a.body.slice(0, LONG).trimEnd() + '…';
          return (
            <li
              key={a.id}
              className={`card p-4 space-y-2 ${a.pinned ? 'border-gold-500 bg-gold-400/10' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {a.pinned && (
                  <span className="badge bg-gold-400/30 text-gold-600 text-xs">
                    <Pin className="w-3 h-3 mr-1" aria-hidden /> Pinned
                  </span>
                )}
                {a.audience === 'staff' && (
                  <span className="badge bg-pitch-100 text-pitch-700 text-xs">Staff only</span>
                )}
                <span className="text-xs text-pitch-600">
                  {new Date(a.publish_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <h3 className="font-semibold text-lg leading-snug">{a.title}</h3>
              <Body text={text} />
              {long && (
                <button
                  type="button"
                  className="text-sm font-medium text-pitch-700 underline min-h-[44px]"
                  onClick={() => setOpen({ ...open, [a.id]: !expanded })}
                >
                  {expanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
