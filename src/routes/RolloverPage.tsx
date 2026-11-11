import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/auth';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock, Field } from '@/components/ui';
import PlayerAvatar from '@/components/PlayerAvatar';
import { usePlayerPhotoUrls } from '@/lib/photos';
import { calcAge, errMsg, formatDay } from '@/lib/util';

interface SeasonRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  cut_off_date: string | null;
  is_current: boolean;
}

interface PreviewRow {
  player_id: string;
  player_name: string;
  photo_path: string | null;
  dob: string;
  club_name: string;
  team_name: string;
  division_name: string;
  reason: string | null;
  default_team_name: string | null;
  default_division_name: string | null;
}

interface ResultRow {
  player_id: string;
  player_name: string;
  photo_path: string | null;
  club_name: string;
  from_team: string;
  from_division: string;
  to_team: string | null;
  to_division: string | null;
  outcome: 'aged_out_placed' | 'aged_out_unplaced' | 'carried' | 'skipped';
}

interface RolloverRecord {
  carried: number;
  aged_out_placed: number;
  aged_out_unplaced: number;
  skipped: number;
  moves_rejected: number;
  suspensions_updated: number;
  done_at: string;
}

interface Counts {
  carry: number;
  ageing: number;
}

function Stat({ value, label, warn }: { value: number; label: string; warn?: boolean }) {
  return (
    <div className={`card p-4 text-center ${warn && value > 0 ? 'border-ember-500' : ''}`}>
      <p className={`font-display font-bold text-3xl ${warn && value > 0 ? 'text-ember-700' : ''}`}>
        {value}
      </p>
      <p className="text-sm text-pitch-700">{label}</p>
    </div>
  );
}

export default function RolloverPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [loadingSeasons, setLoadingSeasons] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [record, setRecord] = useState<RolloverRecord | null>(null);
  const [counts, setCounts] = useState<Counts>({ carry: 0, ageing: 0 });
  const [ageing, setAgeing] = useState<PreviewRow[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const photoUrls = usePlayerPhotoUrls(
    [...ageing, ...results].map((r) => ({ id: r.player_id, photo_path: r.photo_path }))
  );

  const from = seasons.find((s) => s.id === fromId);
  const to = seasons.find((s) => s.id === toId);
  const laterSeasons = useMemo(
    () => (from ? seasons.filter((s) => s.start_date > from.start_date) : []),
    [seasons, from]
  );

  const loadSeasons = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('season')
      .select('id, name, start_date, end_date, cut_off_date, is_current')
      .order('start_date', { ascending: true });
    if (err) {
      setError('Could not load seasons. Check your connection and try again.');
      setLoadingSeasons(false);
      return;
    }
    const list = (data ?? []) as SeasonRow[];
    setSeasons(list);
    const current = list.find((s) => s.is_current) ?? list[list.length - 1];
    if (current) {
      setFromId(current.id);
      const next = list.find((s) => s.start_date > current.start_date);
      setToId(next?.id ?? '');
    }
    setLoadingSeasons(false);
  }, []);

  useEffect(() => {
    loadSeasons();
  }, [loadSeasons]);

  // Refresh the season list without touching which seasons are selected.
  const refreshSeasons = useCallback(async () => {
    const { data } = await supabase
      .from('season')
      .select('id, name, start_date, end_date, cut_off_date, is_current')
      .order('start_date', { ascending: true });
    if (data) setSeasons(data as SeasonRow[]);
  }, []);

  const loadDetail = useCallback(async () => {
    if (!fromId || !toId) return;
    setLoadingDetail(true);
    setError(null);

    const rec = await supabase
      .from('season_rollover')
      .select('carried, aged_out_placed, aged_out_unplaced, skipped, moves_rejected, suspensions_updated, done_at')
      .eq('to_season_id', toId)
      .maybeSingle();
    if (rec.error) {
      setError('Could not load the rollover. If you have just updated the app, run the latest database setup file (ALL_IN_ONE_setup.sql) in Supabase, then refresh.');
      setLoadingDetail(false);
      return;
    }

    if (rec.data) {
      const res = await supabase.rpc('rollover_results', { p_to: toId, p_only_changes: true });
      if (res.error) {
        setError('Could not load the rollover results.');
      } else {
        setResults((res.data ?? []) as ResultRow[]);
      }
      setRecord(rec.data as RolloverRecord);
      setAgeing([]);
    } else {
      const args = { p_from: fromId, p_to: toId };
      const [countRes, ageingRes] = await Promise.all([
        supabase.rpc('rollover_preview', args).select('outcome'),
        supabase.rpc('rollover_preview', args).eq('outcome', 'ageing_out'),
      ]);
      if (countRes.error || ageingRes.error) {
        setError('Could not load the preview. If you have just updated the app, run the latest database setup file (ALL_IN_ONE_setup.sql) in Supabase, then refresh.');
      } else {
        const outcomes = (countRes.data ?? []) as { outcome: string }[];
        setCounts({
          carry: outcomes.filter((o) => o.outcome === 'carry').length,
          ageing: outcomes.filter((o) => o.outcome === 'ageing_out').length,
        });
        setAgeing((ageingRes.data ?? []) as PreviewRow[]);
      }
      setRecord(null);
      setResults([]);
    }
    setLoadingDetail(false);
  }, [fromId, toId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  async function runRollover() {
    if (!fromId || !toId) return;
    setError(null);
    setOk(null);
    setBusy(true);
    const { error: err } = await supabase.rpc('run_season_rollover', { p_from: fromId, p_to: toId });
    setBusy(false);
    setConfirming(false);
    if (err) return setError(errMsg(err));
    setOk('Rollover complete. Everyone has been carried into the new season.');
    await loadDetail();
  }

  async function makeCurrent() {
    if (!toId) return;
    setError(null);
    setOk(null);
    setBusy(true);
    const { error: err } = await supabase.rpc('set_current_season', { p_season_id: toId });
    setBusy(false);
    if (err) return setError(errMsg(err));
    setOk(`${to?.name} is now the current season.`);
    await refreshSeasons();
  }

  const unplacedPreview = ageing.filter((r) => !r.default_team_name).length;
  const scope = isAdmin ? '' : ' at your club';

  return (
    <div className="space-y-6">
      <PageHeader
        icon={RefreshCw}
        title="Season rollover"
        intro={
          isAdmin
            ? 'Carry registrations into the new season and place players who have aged out of Under 18. Preview first, then run it once.'
            : 'See which of your players will age out of Under 18 before the new season starts, and who is placed where.'
        }
      />

      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      {loadingSeasons ? (
        <LoadingBlock />
      ) : seasons.length < 2 || laterSeasons.length === 0 ? (
        <div className="card p-6 space-y-2">
          <p className="font-semibold">There is no new season to roll over to yet.</p>
          <p className="text-pitch-700">
            {isAdmin ? (
              <>
                First create the new season on the{' '}
                <Link to="/admin/seasons" className="underline">
                  Seasons page
                </Link>
                , with its start date and its Under 18 age cut-off date.
              </>
            ) : (
              'An administrator needs to create the new season first.'
            )}
          </p>
        </div>
      ) : (
        <>
          <section className="card p-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rolling over from">
                <select
                  className="input"
                  value={fromId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setFromId(id);
                    const f = seasons.find((s) => s.id === id);
                    const next = f ? seasons.find((s) => s.start_date > f.start_date) : undefined;
                    setToId(next?.id ?? '');
                    setConfirming(false);
                  }}
                >
                  {seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.is_current ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rolling over to">
                <select
                  className="input"
                  value={toId}
                  onChange={(e) => {
                    setToId(e.target.value);
                    setConfirming(false);
                  }}
                >
                  {laterSeasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {to && (
              <p className="text-sm text-pitch-700">
                {to.name} runs {formatDay(to.start_date)} to {formatDay(to.end_date)}. Under 18
                age cut-off:{' '}
                {to.cut_off_date ? (
                  <strong>born on or after {formatDay(to.cut_off_date)}</strong>
                ) : (
                  <strong className="text-ember-700">not set</strong>
                )}
                .
              </p>
            )}
            {to && !to.cut_off_date && (
              <div className="card p-3 border-ember-500 bg-ember-500/10 text-sm text-ember-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                <span>
                  {isAdmin ? (
                    <>
                      This season has no age cut-off date, so the rollover cannot run. Set it on the{' '}
                      <Link to="/admin/seasons" className="underline">
                        Seasons page
                      </Link>
                      .
                    </>
                  ) : (
                    'This season has no age cut-off date yet, so the list below may be incomplete. Ask an administrator to set it.'
                  )}
                </span>
              </div>
            )}
          </section>

          {loadingDetail && <LoadingBlock />}

          {!loadingDetail && !record && (
            <>
              <section className="grid grid-cols-2 gap-3">
                <Stat value={counts.carry} label={`staying where they are${scope}`} />
                <Stat value={counts.ageing} label={`ageing out of their division${scope}`} warn />
              </section>

              <section className="space-y-3">
                <h2 className="font-display font-bold text-lg">Ageing out</h2>
                {ageing.length === 0 ? (
                  <div className="card p-6 text-center text-pitch-600">
                    No players are ageing out{scope} for {to?.name}.
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-pitch-700">
                      These players are too old for their division in {to?.name}. At rollover they
                      are placed in the entry-level men&rsquo;s division, or the women&rsquo;s
                      division, at the same club.
                      {unplacedPreview > 0 &&
                        ` ${unplacedPreview} ${unplacedPreview === 1 ? 'has' : 'have'} no team to go to and will need one added by hand.`}
                    </p>
                    <ul className="space-y-3">
                      {ageing.map((r) => (
                        <li key={r.player_id} className="card p-4 flex items-start gap-3">
                          <PlayerAvatar name={r.player_name} url={photoUrls[r.player_id]} size="md" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <Link
                              to={`/players/${r.player_id}`}
                              className="block font-semibold truncate hover:underline"
                            >
                              {r.player_name}
                            </Link>
                            <p className="text-sm text-pitch-600">
                              Born {formatDay(r.dob)}, {calcAge(r.dob)} years old
                              {isAdmin ? `, ${r.club_name}` : ''}
                            </p>
                            <p className="text-sm">
                              {r.team_name} ({r.division_name}){' '}
                              <span aria-hidden>&rarr;</span>{' '}
                              {r.default_team_name ? (
                                <strong>
                                  {r.default_team_name} ({r.default_division_name})
                                </strong>
                              ) : (
                                <strong className="text-ember-700">no team at this club</strong>
                              )}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              {isAdmin && to && (
                <section className="card p-4 space-y-3">
                  <h2 className="font-display font-bold text-lg">Run the rollover</h2>
                  <ul className="list-disc pl-5 text-sm text-pitch-700 space-y-1">
                    <li>Every active player is registered again in {to.name}, on the same team.</li>
                    <li>Players who have aged out are placed as shown above.</li>
                    <li>Suspensions that are not yet served carry over into {to.name}.</li>
                    <li>Division moves still in progress are cancelled, and clubs must request them again.</li>
                    <li>It happens all at once or not at all, and can only be done once.</li>
                  </ul>
                  {!confirming ? (
                    <button
                      className="btn-primary"
                      disabled={!to.cut_off_date || busy}
                      onClick={() => setConfirming(true)}
                    >
                      Run rollover to {to.name}
                    </button>
                  ) : (
                    <div className="card p-3 border-gold-500 bg-gold-400/10 space-y-3">
                      <p className="font-medium">
                        Roll {from?.name} over to {to.name} now? This cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <button className="btn-primary" disabled={busy} onClick={runRollover}>
                          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                          Yes, run it
                        </button>
                        <button className="btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
                          Not yet
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {!loadingDetail && record && (
            <>
              <section className="space-y-3">
                <div className="card p-4 border-pitch-300 bg-pitch-50">
                  <p className="font-semibold">
                    {from?.name} was rolled over to {to?.name} on{' '}
                    {formatDay(record.done_at.slice(0, 10))}.
                  </p>
                </div>
                {isAdmin && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <Stat value={record.carried} label="carried over" />
                    <Stat value={record.aged_out_placed} label="aged out and placed" />
                    <Stat value={record.aged_out_unplaced} label="need a team" warn />
                    <Stat value={record.moves_rejected} label="moves cancelled" />
                    <Stat value={record.suspensions_updated} label="bans carried over" />
                  </div>
                )}
              </section>

              {isAdmin && to && !to.is_current && (
                <section className="card p-4 space-y-3">
                  <h2 className="font-display font-bold text-lg">Next step</h2>
                  <p className="text-sm text-pitch-700">
                    {to.name} is not the current season yet. Until it is, the public pages and
                    registration forms still use {from?.name}.
                  </p>
                  <button className="btn-primary" disabled={busy} onClick={makeCurrent}>
                    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                    Make {to.name} the current season
                  </button>
                </section>
              )}

              <section className="space-y-3">
                <h2 className="font-display font-bold text-lg">Players who aged out</h2>
                {results.length === 0 ? (
                  <div className="card p-6 text-center text-pitch-600">
                    No players aged out{scope}.
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {results.map((r) => (
                      <li key={r.player_id} className="card p-4 flex items-start gap-3">
                        <PlayerAvatar name={r.player_name} url={photoUrls[r.player_id]} size="md" />
                        <div className="min-w-0 flex-1 space-y-1">
                          <Link
                            to={`/players/${r.player_id}`}
                            className="block font-semibold truncate hover:underline"
                          >
                            {r.player_name}
                          </Link>
                          <p className="text-sm">
                            {r.from_team} ({r.from_division}) <span aria-hidden>&rarr;</span>{' '}
                            {r.to_team ? (
                              <strong>
                                {r.to_team} ({r.to_division})
                              </strong>
                            ) : (
                              <strong className="text-ember-700">needs a team</strong>
                            )}
                          </p>
                          {!r.to_team && (
                            <p className="text-xs text-pitch-600">
                              This club has no team in the default division. Add a team, then
                              register the player from the{' '}
                              <Link to="/players" className="underline">
                                Players page
                              </Link>
                              .
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {results.some((r) => r.to_team) && (
                  <p className="text-sm text-pitch-700">
                    To move a placed player up a division, use{' '}
                    <Link to="/moves" className="underline">
                      Division moves
                    </Link>{' '}
                    during the transfer window.
                  </p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
