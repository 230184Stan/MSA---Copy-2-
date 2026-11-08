import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Plus, Loader2, Star, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { Season } from '@/lib/types';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock, Field } from '@/components/ui';
import { errMsg, formatDay } from '@/lib/util';

interface TransferWindow {
  id: string;
  season_id: string;
  opens_on: string;
  closes_on: string;
}

function WindowForm({ seasonId, onAdded }: { seasonId: string; onAdded: () => void }) {
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!opens || !closes) return setErr('Enter both dates.');
    if (closes <= opens) return setErr('The window must close after it opens.');
    setBusy(true);
    const { error } = await supabase
      .from('transfer_window')
      .insert({ season_id: seasonId, opens_on: opens, closes_on: closes });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setOpens('');
    setCloses('');
    onAdded();
  }

  return (
    <form onSubmit={add} className="mt-3 space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opens on">
          <input type="date" className="input" value={opens} onChange={(e) => setOpens(e.target.value)} />
        </Field>
        <Field label="Closes on">
          <input type="date" className="input" value={closes} onChange={(e) => setCloses(e.target.value)} />
        </Field>
      </div>
      <ErrorNote message={err} />
      <button className="btn-secondary text-sm" disabled={busy}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
        Add transfer window
      </button>
    </form>
  );
}

export default function SeasonsPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [windows, setWindows] = useState<TransferWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '', cut_off_date: '' });

  const load = useCallback(async () => {
    const [s, w] = await Promise.all([
      supabase.from('season').select('*').order('start_date', { ascending: false }),
      supabase.from('transfer_window').select('*').order('opens_on'),
    ]);
    if (s.error || w.error) {
      setError('Could not load seasons. Check your connection and try again.');
    } else {
      setSeasons((s.data ?? []) as Season[]);
      setWindows((w.data ?? []) as TransferWindow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function makeCurrent(id: string) {
    setError(null);
    setOk(null);
    const { error: err } = await supabase.rpc('set_current_season', { p_season_id: id });
    if (err) return setError(errMsg(err));
    setOk('Current season updated.');
    load();
  }

  async function addSeason(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!form.name.trim()) return setError('Season name is required (for example 2027).');
    if (!form.start_date || !form.end_date) return setError('Enter the start and end dates.');
    if (form.end_date <= form.start_date) return setError('The season must end after it starts.');
    setBusy(true);
    const { data, error: err } = await supabase
      .from('season')
      .insert({
        name: form.name.trim(),
        start_date: form.start_date,
        end_date: form.end_date,
        cut_off_date: form.cut_off_date || null,
        is_current: false,
      })
      .select('id')
      .single();
    if (err) {
      setBusy(false);
      return setError(errMsg(err));
    }
    // The very first season becomes the current one automatically.
    if (seasons.length === 0 && data) {
      await supabase.rpc('set_current_season', { p_season_id: data.id });
    }
    setBusy(false);
    setOk(`Season "${form.name.trim()}" created.`);
    setForm({ name: '', start_date: '', end_date: '', cut_off_date: '' });
    load();
  }

  async function removeWindow(id: string) {
    if (!window.confirm('Remove this transfer window?')) return;
    setError(null);
    const { error: err } = await supabase.from('transfer_window').delete().eq('id', id);
    if (err) return setError(errMsg(err));
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarDays}
        title="Seasons & transfer windows"
        intro="Create each season, choose which one is current, and set the dates when players may move divisions."
      />
      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <form onSubmit={addSeason} className="card p-4 space-y-3">
            <h2 className="font-display font-bold text-lg">New season</h2>
            <Field label="Season name" hint="For example 2027">
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">
                <input
                  type="date"
                  className="input"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </Field>
              <Field label="Ends">
                <input
                  type="date"
                  className="input"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
              </Field>
            </div>
            <Field
              label="Under 18 birth-date cut-off"
              hint="Players born ON OR AFTER this date can play Under 18 this season. Example: for 2027 use 1 Jan 2009. Leave blank only if you will not run an Under 18 division."
            >
              <input
                type="date"
                className="input"
                value={form.cut_off_date}
                onChange={(e) => setForm({ ...form, cut_off_date: e.target.value })}
              />
            </Field>
            <button className="btn-primary" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
              Create season
            </button>
          </form>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg">Seasons</h2>
            {seasons.length === 0 && <div className="card p-4 text-pitch-600">No seasons yet.</div>}
            {seasons.map((s) => {
              const ws = windows.filter((w) => w.season_id === s.id);
              return (
                <article key={s.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <h3 className="font-semibold text-lg flex items-center gap-2">
                        {s.name}
                        {s.is_current && (
                          <span className="badge bg-gold-400/30 text-gold-600">
                            <Star className="w-3.5 h-3.5 mr-1" aria-hidden /> Current
                          </span>
                        )}
                      </h3>
                      <p className="text-sm text-pitch-600">
                        {formatDay(s.start_date)} to {formatDay(s.end_date)}
                      </p>
                      <p className="text-sm text-pitch-600">
                        Under 18 cut-off: {s.cut_off_date ? formatDay(s.cut_off_date) : 'not set'}
                      </p>
                    </div>
                    {!s.is_current && (
                      <button className="btn-secondary text-sm" onClick={() => makeCurrent(s.id)}>
                        Make current
                      </button>
                    )}
                  </div>

                  <h4 className="mt-4 font-semibold text-sm text-pitch-800">Transfer windows</h4>
                  {ws.length === 0 ? (
                    <p className="text-sm text-pitch-600">
                      None set. Outside a window only an admin can approve a move.
                    </p>
                  ) : (
                    <ul className="divide-y divide-pitch-100">
                      {ws.map((w) => (
                        <li key={w.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                          <span>
                            {formatDay(w.opens_on)} to {formatDay(w.closes_on)}
                          </span>
                          <button
                            onClick={() => removeWindow(w.id)}
                            className="p-2 min-h-[44px] min-w-[44px] text-ember-600 hover:bg-ember-500/10 rounded-lg"
                            aria-label="Remove transfer window"
                          >
                            <Trash2 className="w-4 h-4 mx-auto" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <WindowForm seasonId={s.id} onAdded={load} />
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
