import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Save, ShieldAlert } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/auth';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock, Field } from '@/components/ui';
import PlayerAvatar from '@/components/PlayerAvatar';
import { usePlayerPhotoUrls } from '@/lib/photos';
import { errMsg, formatDay } from '@/lib/util';

interface SuspensionRow {
  id: string;
  player_id: string;
  player_name: string;
  photo_path: string | null;
  team_name: string | null;
  club_name: string | null;
  competition_name: string | null;
  reason: 'red_card' | 'yellow_accumulation' | 'admin';
  matches_banned: number;
  matches_served: number;
  matches_remaining: number;
  status: 'active' | 'served' | 'cancelled';
  notes: string | null;
  source_label: string | null;
  created_at: string;
}

interface Settings {
  red_card_matches: number;
  yellow_card_limit: number;
  yellow_ban_matches: number;
}

interface PlayerOption {
  id: string;
  full_name: string;
}

const REASON_TEXT: Record<SuspensionRow['reason'], string> = {
  red_card: 'Red card',
  yellow_accumulation: 'Yellow card build-up',
  admin: 'Added by an administrator',
};

const STATUS_TEXT: Record<SuspensionRow['status'], string> = {
  active: 'Suspended',
  served: 'Served',
  cancelled: 'Cancelled',
};

const STATUS_STYLE: Record<SuspensionRow['status'], string> = {
  active: 'bg-ember-500/10 text-ember-700',
  served: 'bg-pitch-100 text-pitch-700',
  cancelled: 'bg-pitch-50 text-pitch-600',
};

function SuspensionCard({
  s,
  photoUrl,
  isAdmin,
  busy,
  cancelling,
  onStartCancel,
  onChangeCancel,
  onConfirmCancel,
  onAbortCancel,
}: {
  s: SuspensionRow;
  photoUrl?: string;
  isAdmin: boolean;
  busy: boolean;
  cancelling: string | null;
  onStartCancel: () => void;
  onChangeCancel: (v: string) => void;
  onConfirmCancel: () => void;
  onAbortCancel: () => void;
}) {
  return (
    <li className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <PlayerAvatar name={s.player_name} url={photoUrl} size="md" />
        <div className="min-w-0 flex-1">
          <Link
            to={`/players/${s.player_id}`}
            className="block font-semibold truncate hover:underline"
          >
            {s.player_name}
          </Link>
          <p className="text-sm text-pitch-600 truncate">
            {[s.team_name, s.club_name].filter(Boolean).join(', ') || 'No current team'}
          </p>
        </div>
        <span className={`badge text-xs shrink-0 ${STATUS_STYLE[s.status]}`}>
          {STATUS_TEXT[s.status]}
        </span>
      </div>

      <div className="text-sm space-y-1">
        <p>
          <span className="font-medium">{REASON_TEXT[s.reason]}</span>
          {s.source_label ? `, ${s.source_label}` : ''}
        </p>
        <p className="text-pitch-700">
          {s.status === 'active'
            ? `${s.matches_remaining} of ${s.matches_banned} ${s.matches_banned === 1 ? 'match' : 'matches'} left to serve`
            : `${s.matches_banned}-match ban, ${s.matches_served} served`}
          {s.competition_name ? `, ${s.competition_name}` : ''}
        </p>
        <p className="text-xs text-pitch-600">Added {formatDay(s.created_at.slice(0, 10))}</p>
        {s.notes && <p className="text-pitch-700">Note: {s.notes}</p>}
      </div>

      {isAdmin && s.status === 'active' && cancelling === null && (
        <button className="btn-secondary" onClick={onStartCancel}>
          Cancel this suspension
        </button>
      )}
      {isAdmin && s.status === 'active' && cancelling !== null && (
        <div className="space-y-2">
          <Field label="Why is it being cancelled?" hint="For example: decision overturned on appeal.">
            <input
              className="input"
              value={cancelling}
              onChange={(e) => onChangeCancel(e.target.value)}
              autoFocus
            />
          </Field>
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={busy || !cancelling.trim()}
              onClick={onConfirmCancel}
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
              Confirm cancellation
            </button>
            <button className="btn-secondary" onClick={onAbortCancel}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function DisciplinePage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [rows, setRows] = useState<SuspensionRow[]>([]);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [cancelling, setCancelling] = useState<{ id: string; reason: string } | null>(null);

  const [form, setForm] = useState({ playerId: '', matches: '1', notes: '' });
  const [filter, setFilter] = useState('');

  const photoUrls = usePlayerPhotoUrls(
    rows.map((r) => ({ id: r.player_id, photo_path: r.photo_path }))
  );

  const load = useCallback(async () => {
    const requests = [
      supabase.rpc('my_suspensions'),
      isAdmin ? supabase.from('player').select('id, full_name').order('full_name') : null,
      supabase
        .from('discipline_settings')
        .select('red_card_matches, yellow_card_limit, yellow_ban_matches')
        .maybeSingle(),
    ] as const;
    const [susRes, playerRes, settingsRes] = await Promise.all(requests);

    if (susRes.error) {
      setError(
        'Could not load suspensions. If you have just updated the app, run the latest database setup file (ALL_IN_ONE_setup.sql) in Supabase, then refresh.'
      );
      setLoading(false);
      return;
    }
    setRows((susRes.data ?? []) as SuspensionRow[]);
    setPlayers(((playerRes?.data ?? []) as PlayerOption[]).slice());
    setSettings((settingsRes.data as Settings | null) ?? null);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const active = rows.filter((r) => r.status === 'active');
  const history = rows.filter((r) => r.status !== 'active');
  const shown = tab === 'active' ? active : history;

  const visiblePlayers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? players.filter((p) => p.full_name.toLowerCase().includes(q)) : players;
  }, [players, filter]);

  async function addSuspension(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!form.playerId) return setError('Choose a player.');
    const matches = Number(form.matches);
    if (!Number.isInteger(matches) || matches < 1 || matches > 50) {
      return setError('Enter a number of matches from 1 to 50.');
    }
    setBusy('add');
    const { error: err } = await supabase.rpc('add_suspension', {
      p_player_id: form.playerId,
      p_matches: matches,
      p_notes: form.notes,
    });
    setBusy(null);
    if (err) return setError(errMsg(err));
    setOk('Suspension added.');
    setForm({ playerId: '', matches: '1', notes: '' });
    setFilter('');
    await load();
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setError(null);
    setOk(null);
    setBusy(cancelling.id);
    const { error: err } = await supabase.rpc('cancel_suspension', {
      p_id: cancelling.id,
      p_reason: cancelling.reason,
    });
    setBusy(null);
    if (err) return setError(errMsg(err));
    setOk('Suspension cancelled.');
    setCancelling(null);
    await load();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setError(null);
    setOk(null);
    const { red_card_matches: r, yellow_card_limit: l, yellow_ban_matches: y } = settings;
    if (![r, l, y].every((n) => Number.isInteger(n) && n >= 1 && n <= 50)) {
      return setError('Each rule must be a whole number from 1 to 50.');
    }
    setBusy('settings');
    const { error: err } = await supabase
      .from('discipline_settings')
      .update({ red_card_matches: r, yellow_card_limit: l, yellow_ban_matches: y, updated_at: new Date().toISOString() })
      .eq('id', true);
    setBusy(null);
    if (err) return setError(errMsg(err));
    setOk('Rules saved. They apply to cards recorded from now on.');
  }

  function numberField(key: keyof Settings, value: string) {
    setSettings((s) => (s ? { ...s, [key]: value === '' ? 0 : Number(value.replace(/\D/g, '')) } : s));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldAlert}
        title="Discipline"
        intro={
          isAdmin
            ? 'Red cards and yellow card build-up create suspensions automatically. A ban is served as the player’s team completes its next matches in that competition.'
            : 'Suspensions for players at your club. A suspended player cannot be moved to another division.'
        }
      />

      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="flex gap-2" role="tablist">
            {(
              [
                ['active', `Suspended now (${active.length})`],
                ['history', `History (${history.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={tab === key ? 'btn-primary' : 'btn-secondary'}
              >
                {label}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="card p-6 text-center text-pitch-600">
              {tab === 'active' ? 'No players are suspended right now.' : 'No past suspensions yet.'}
            </div>
          ) : (
            <ul className="space-y-3">
              {shown.map((s) => (
                <SuspensionCard
                  key={s.id}
                  s={s}
                  photoUrl={photoUrls[s.player_id]}
                  isAdmin={isAdmin}
                  busy={busy === s.id}
                  cancelling={cancelling?.id === s.id ? cancelling.reason : null}
                  onStartCancel={() => setCancelling({ id: s.id, reason: '' })}
                  onChangeCancel={(v) => setCancelling({ id: s.id, reason: v })}
                  onConfirmCancel={confirmCancel}
                  onAbortCancel={() => setCancelling(null)}
                />
              ))}
            </ul>
          )}

          {isAdmin && (
            <>
              <section className="card p-4 space-y-4">
                <h2 className="font-display font-bold text-lg">Add a suspension</h2>
                <form onSubmit={addSuspension} className="space-y-4">
                  <Field label="Find a player" hint="Type part of a name to shorten the list.">
                    <input
                      className="input"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Search by name"
                    />
                  </Field>
                  <Field label="Player">
                    <select
                      className="input"
                      value={form.playerId}
                      onChange={(e) => setForm({ ...form, playerId: e.target.value })}
                    >
                      <option value="">Choose a player</option>
                      {visiblePlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Number of matches" hint="Counts down as their team plays, in any competition.">
                    <input
                      className="input !w-28"
                      inputMode="numeric"
                      value={form.matches}
                      onChange={(e) =>
                        setForm({ ...form, matches: e.target.value.replace(/\D/g, '').slice(0, 2) })
                      }
                    />
                  </Field>
                  <Field label="Reason" hint="Required. It is kept on the record.">
                    <input
                      className="input"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder="For example: abusive language after the match"
                    />
                  </Field>
                  <button className="btn-primary w-full sm:w-auto" disabled={busy === 'add'}>
                    {busy === 'add' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                    Add suspension
                  </button>
                </form>
              </section>

              {settings && (
                <section className="card p-4 space-y-4">
                  <h2 className="font-display font-bold text-lg">Discipline rules</h2>
                  <p className="text-sm text-pitch-600">
                    Check these against your association’s rules before the season starts.
                  </p>
                  <form onSubmit={saveSettings} className="space-y-4">
                    <Field label="Matches banned for a red card">
                      <input
                        className="input !w-28"
                        inputMode="numeric"
                        value={settings.red_card_matches || ''}
                        onChange={(e) => numberField('red_card_matches', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Yellow cards in one competition that lead to a ban"
                      hint="Every time a player reaches this many, they are banned."
                    >
                      <input
                        className="input !w-28"
                        inputMode="numeric"
                        value={settings.yellow_card_limit || ''}
                        onChange={(e) => numberField('yellow_card_limit', e.target.value)}
                      />
                    </Field>
                    <Field label="Matches banned for yellow card build-up">
                      <input
                        className="input !w-28"
                        inputMode="numeric"
                        value={settings.yellow_ban_matches || ''}
                        onChange={(e) => numberField('yellow_ban_matches', e.target.value)}
                      />
                    </Field>
                    <button className="btn-primary" disabled={busy === 'settings'}>
                      {busy === 'settings' ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                      ) : (
                        <Save className="w-4 h-4" aria-hidden />
                      )}
                      Save rules
                    </button>
                  </form>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
