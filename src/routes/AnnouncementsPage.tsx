import { useCallback, useEffect, useState } from 'react';
import { Loader2, Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock, Field } from '@/components/ui';
import { errMsg } from '@/lib/util';
import {
  announcementState,
  sortForDisplay,
  toLocalInput,
  type Announcement,
  type Audience,
} from '@/lib/announcements';

interface Form {
  title: string;
  body: string;
  audience: Audience;
  pinned: boolean;
  publishAt: string; // datetime-local, '' = now
  expiresAt: string; // datetime-local, '' = never
}

const EMPTY: Form = { title: '', body: '', audience: 'public', pinned: false, publishAt: '', expiresAt: '' };

const STATE_STYLE = {
  live: 'bg-pitch-100 text-pitch-700',
  scheduled: 'bg-gold-400/30 text-gold-600',
  expired: 'bg-gray-100 text-gray-600',
} as const;
const STATE_LABEL = { live: 'Live', scheduled: 'Scheduled', expired: 'Expired' } as const;

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('announcement')
      .select('id, title, body, audience, pinned, publish_at, expires_at');
    if (err) setError('Could not load announcements. Has migration 022 been run in Supabase?');
    else setItems(sortForDisplay((data ?? []) as Announcement[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(a: Announcement) {
    setEditingId(a.id);
    setForm({
      title: a.title,
      body: a.body,
      audience: a.audience,
      pinned: a.pinned,
      publishAt: toLocalInput(a.publish_at),
      expiresAt: toLocalInput(a.expires_at),
    });
    setError(null);
    setOk(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    const title = form.title.trim();
    const body = form.body.trim();
    if (!title) return setError('Give the announcement a title.');
    if (title.length > 120) return setError('The title is too long (120 characters at most).');
    if (!body) return setError('Write the message.');
    if (body.length > 4000) return setError('The message is too long (4000 characters at most).');
    const publish = form.publishAt ? new Date(form.publishAt) : new Date();
    const expires = form.expiresAt ? new Date(form.expiresAt) : null;
    if (Number.isNaN(publish.getTime()) || (expires && Number.isNaN(expires.getTime()))) {
      return setError('One of the dates is not valid.');
    }
    if (expires && expires <= publish) return setError('The end date must be after the start date.');

    const row = {
      title,
      body,
      audience: form.audience,
      pinned: form.pinned,
      publish_at: publish.toISOString(),
      expires_at: expires ? expires.toISOString() : null,
    };
    setBusy(true);
    const { error: err } = editingId
      ? await supabase.from('announcement').update(row).eq('id', editingId)
      : await supabase.from('announcement').insert(row);
    setBusy(false);
    if (err) return setError(errMsg(err, 'Could not save the announcement.'));
    setOk(editingId ? 'Announcement updated.' : publish > new Date() ? 'Announcement scheduled.' : 'Announcement published.');
    reset();
    load();
  }

  async function togglePin(a: Announcement) {
    setError(null);
    setOk(null);
    const { error: err } = await supabase.from('announcement').update({ pinned: !a.pinned }).eq('id', a.id);
    if (err) return setError(errMsg(err, 'Could not change that.'));
    load();
  }

  async function onDelete(a: Announcement) {
    if (!window.confirm(`Delete the announcement "${a.title}"? This cannot be undone.`)) return;
    setError(null);
    setOk(null);
    const { error: err } = await supabase.from('announcement').delete().eq('id', a.id);
    if (err) return setError(errMsg(err, 'Could not delete it.'));
    if (editingId === a.id) reset();
    setOk('Announcement deleted.');
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Megaphone}
        title="Announcements"
        intro="Post notices on the home page. Choose whether everyone sees them or only signed-in staff."
      />
      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      <form onSubmit={onSave} className="card p-4 space-y-3">
        <h2 className="font-display font-bold text-lg">{editingId ? 'Edit announcement' : 'New announcement'}</h2>
        <Field label="Title">
          <input
            className="input"
            value={form.title}
            maxLength={120}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Registration closes Friday"
          />
        </Field>
        <Field label="Message" hint="Plain text. Web addresses starting with https:// become links.">
          <textarea
            className="input"
            rows={5}
            value={form.body}
            maxLength={4000}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </Field>
        <Field label="Who can see it">
          <select
            className="input"
            value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value as Audience })}
          >
            <option value="public">Everyone (public home page)</option>
            <option value="staff">Signed-in staff only (administrators, club managers, referees)</option>
          </select>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Show from" hint="Leave empty to show straight away">
            <input
              className="input"
              type="datetime-local"
              value={form.publishAt}
              onChange={(e) => setForm({ ...form, publishAt: e.target.value })}
            />
          </Field>
          <Field label="Hide after" hint="Leave empty to keep it up until you delete it">
            <input
              className="input"
              type="datetime-local"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 min-h-[44px] text-sm">
          <input
            type="checkbox"
            className="w-5 h-5"
            checked={form.pinned}
            onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
          />
          Pin to the top
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
            {editingId ? 'Save changes' : 'Publish'}
          </button>
          {editingId && (
            <button type="button" className="btn-secondary" onClick={reset} disabled={busy}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <section className="space-y-3">
        <h2 className="font-display font-bold text-lg">All announcements ({items.length})</h2>
        {loading ? (
          <LoadingBlock />
        ) : items.length === 0 ? (
          <div className="card p-4 text-pitch-600">Nothing posted yet.</div>
        ) : (
          <ul className="space-y-3">
            {items.map((a) => {
              const state = announcementState(a);
              return (
                <li key={a.id} className="card p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge text-xs ${STATE_STYLE[state]}`}>{STATE_LABEL[state]}</span>
                    {a.audience === 'staff' && <span className="badge bg-pitch-100 text-pitch-700 text-xs">Staff only</span>}
                    {a.pinned && (
                      <span className="badge bg-gold-400/30 text-gold-600 text-xs">
                        <Pin className="w-3 h-3 mr-1" aria-hidden /> Pinned
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-lg leading-snug">{a.title}</h3>
                  <p className="text-sm text-pitch-700 whitespace-pre-line break-words line-clamp-3">{a.body}</p>
                  <p className="text-xs text-pitch-600">
                    From {new Date(a.publish_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    {a.expires_at
                      ? ` until ${new Date(a.expires_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
                      : ' · no end date'}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <button type="button" className="inline-flex items-center gap-1 text-pitch-700 font-medium min-h-[44px] hover:underline" onClick={() => startEdit(a)}>
                      <Pencil className="w-4 h-4" aria-hidden /> Edit
                    </button>
                    <button type="button" className="inline-flex items-center gap-1 text-pitch-700 font-medium min-h-[44px] hover:underline" onClick={() => togglePin(a)}>
                      <Pin className="w-4 h-4" aria-hidden /> {a.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button type="button" className="inline-flex items-center gap-1 text-ember-700 font-medium min-h-[44px] hover:underline" onClick={() => onDelete(a)}>
                      <Trash2 className="w-4 h-4" aria-hidden /> Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
