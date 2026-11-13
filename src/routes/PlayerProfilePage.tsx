import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Camera, Loader2, Trash2, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock } from '@/components/ui';
import PlayerAvatar from '@/components/PlayerAvatar';
import { removePlayerPhoto, uploadPlayerPhoto, usePlayerPhotoUrls } from '@/lib/photos';
import { calcAge, errMsg, formatDay, formatKickoff, one } from '@/lib/util';
import {
  fetchPlayerRecord,
  type DisciplineTotals,
  type EventKind,
  type GameRecord,
  type RecordRegistration,
} from '@/lib/playerRecord';

interface Player {
  id: string;
  full_name: string;
  dob: string;
  gender: 'male' | 'female';
  photo_path: string | null;
  created_at: string;
}

interface RegistrationItem {
  id: string;
  team_id: string;
  status: 'active' | 'ended' | 'suspended';
  start_date: string;
  end_date: string | null;
  team: string;
  division: string;
  season: string;
}

interface SuspensionRow {
  id: string;
  player_id: string;
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

const REASON_TEXT: Record<SuspensionRow['reason'], string> = {
  red_card: 'Red card',
  yellow_accumulation: 'Yellow card accumulation',
  admin: 'Set by an administrator',
};

const EVENT_TEXT: Record<EventKind, string> = {
  goal: 'Goal',
  yellow_card: 'Yellow card',
  red_card: 'Red card',
  substitution: 'Substitution',
};

const EVENT_STYLE: Record<EventKind, string> = {
  goal: 'bg-pitch-100 text-pitch-700',
  yellow_card: 'bg-gold-400/30 text-gold-600',
  red_card: 'bg-ember-500/10 text-ember-700',
  substitution: 'bg-pitch-50 text-pitch-600',
};

const RESULT_STYLE: Record<'W' | 'D' | 'L', string> = {
  W: 'bg-pitch-600 text-white',
  D: 'bg-gold-400 text-pitch-900',
  L: 'bg-ember-600 text-white',
};

const RESULT_TEXT: Record<'W' | 'D' | 'L', string> = { W: 'Win', D: 'Draw', L: 'Loss' };

const STATUS_TEXT: Record<string, string> = {
  active: 'Active',
  ended: 'Ended',
  suspended: 'Suspended',
};

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-pitch-100 text-pitch-700',
  ended: 'bg-pitch-50 text-pitch-600',
  suspended: 'bg-ember-500/10 text-ember-700',
};

export default function PlayerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const from = (location.state as { from?: string; fromLabel?: string } | null) ?? null;
  const fileInput = useRef<HTMLInputElement>(null);

  const [player, setPlayer] = useState<Player | null>(null);
  const [history, setHistory] = useState<RegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suspensions, setSuspensions] = useState<SuspensionRow[]>([]);
  const [suspensionsFailed, setSuspensionsFailed] = useState(false);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [totals, setTotals] = useState<DisciplineTotals>({ goals: 0, yellow: 0, red: 0 });
  const [recordFailed, setRecordFailed] = useState(false);
  const [recordLoaded, setRecordLoaded] = useState(false);

  const photoUrls = usePlayerPhotoUrls(player ? [player] : []);

  const load = useCallback(async () => {
    if (!id) return;
    const [playerRes, regRes] = await Promise.all([
      supabase
        .from('player')
        .select('id, full_name, dob, gender, photo_path, created_at')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('registration')
        .select(
          'id, team_id, status, start_date, end_date, team:team_id(name), division:division_id(name), season:season_id(name)'
        )
        .eq('player_id', id)
        .order('created_at', { ascending: false }),
    ]);

    // Best effort: a failure here must never stop the profile from showing.
    const susRes = await supabase.rpc('my_suspensions');
    if (susRes.error) {
      setSuspensionsFailed(true);
    } else {
      setSuspensionsFailed(false);
      setSuspensions(
        ((susRes.data ?? []) as SuspensionRow[]).filter((x) => x.player_id === id)
      );
    }

    if (playerRes.error) {
      setError('Could not load this player. Check your connection and try again.');
      setLoading(false);
      return;
    }
    if (!playerRes.data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setPlayer(playerRes.data as Player);
    const items: RegistrationItem[] = ((regRes.data ?? []) as unknown[]).map((r) => {
        const row = r as {
          id: string;
          team_id: string;
          status: RegistrationItem['status'];
          start_date: string;
          end_date: string | null;
          team: { name: string } | { name: string }[] | null;
          division: { name: string } | { name: string }[] | null;
          season: { name: string } | { name: string }[] | null;
        };
        return {
          id: row.id,
          team_id: row.team_id,
          status: row.status,
          start_date: row.start_date,
          end_date: row.end_date,
          team: one(row.team)?.name ?? 'Unknown team',
          division: one(row.division)?.name ?? 'Unknown division',
          season: one(row.season)?.name ?? '',
        };
      });
    setHistory(items);
    setLoading(false);

    // The match record fills in after the profile is already on screen.
    const regs: RecordRegistration[] = items.map((h) => ({
      id: h.id,
      team_id: h.team_id,
      team: h.team,
      start_date: h.start_date,
      end_date: h.end_date,
    }));
    const record = await fetchPlayerRecord(regs);
    setRecordFailed(record.failed);
    setGames(record.games);
    setTotals(record.totals);
    setRecordLoaded(true);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function onPhotoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again later
    if (!file || !player) return;
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      const path = await uploadPlayerPhoto(player.id, file, player.photo_path);
      setPlayer({ ...player, photo_path: path });
      setOk('Photo saved.');
    } catch (err) {
      setError(errMsg(err as { code?: string; message?: string }, 'Could not save the photo.'));
    }
    setBusy(false);
  }

  async function onRemove() {
    if (!player?.photo_path) return;
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      await removePlayerPhoto(player.id, player.photo_path);
      setPlayer({ ...player, photo_path: null });
      setOk('Photo removed.');
    } catch (err) {
      setError(errMsg(err as { code?: string; message?: string }, 'Could not remove the photo.'));
    }
    setBusy(false);
  }

  const active = suspensions.filter((x) => x.status === 'active');
  const banLeft = active.length ? Math.max(...active.map((x) => x.matches_remaining)) : null;
  const wins = games.filter((g) => g.result === 'W').length;
  const draws = games.filter((g) => g.result === 'D').length;
  const losses = games.filter((g) => g.result === 'L').length;

  const current = history.find((h) => h.status === 'active' || h.status === 'suspended');

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UserRound}
        title="Player profile"
        backTo={from?.from ?? '/players'}
        backLabel={from?.fromLabel ?? 'Players'}
      />

      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      {loading && <LoadingBlock />}

      {!loading && notFound && (
        <div className="card p-6 text-center text-pitch-700">
          This player could not be found, or you do not have access to them.
        </div>
      )}

      {!loading && player && (
        <>
          <section className="card p-5 flex flex-col items-center gap-4 sm:flex-row sm:items-center">
            <PlayerAvatar name={player.full_name} url={photoUrls[player.id]} size="lg" />
            <div className="text-center sm:text-left space-y-2 min-w-0">
              <h2 className="font-display font-bold text-2xl break-words">{player.full_name}</h2>
              <p className="text-pitch-700">
                {player.gender === 'female' ? 'Female' : 'Male'}, {calcAge(player.dob)} years old
              </p>
              <p className="text-sm text-pitch-600">Born {formatDay(player.dob)}</p>
              {banLeft !== null && (
                <p className="inline-flex items-center gap-2 badge bg-ember-500/10 text-ember-700">
                  Suspended: {banLeft} {banLeft === 1 ? 'match' : 'matches'} left
                </p>
              )}
              {current && (
                <p className="text-sm">
                  <span className="font-semibold">{current.team}</span>, {current.division}
                  <span className={`ml-2 badge text-xs ${STATUS_STYLE[current.status]}`}>
                    {STATUS_TEXT[current.status]}
                  </span>
                </p>
              )}
            </div>
          </section>

          <section className="grid grid-cols-3 sm:grid-cols-6 gap-2" aria-label="Career totals">
            {[
              ['Games', recordLoaded ? games.length : '–'],
              ['Goals', recordLoaded ? totals.goals : '–'],
              ['Yellow', recordLoaded ? totals.yellow : '–'],
              ['Red', recordLoaded ? totals.red : '–'],
              ['Bans', suspensionsFailed ? '–' : suspensions.length],
              ['W-D-L', recordLoaded ? `${wins}-${draws}-${losses}` : '–'],
            ].map(([label, value]) => (
              <div key={label} className="card p-3 text-center">
                <p className="font-display font-bold text-xl">{value}</p>
                <p className="text-xs text-pitch-600">{label}</p>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg">Suspensions</h2>
            {suspensionsFailed ? (
              <div className="card p-4 text-pitch-600">Suspensions could not be loaded right now.</div>
            ) : suspensions.length === 0 ? (
              <div className="card p-4 text-pitch-600">No suspensions on record.</div>
            ) : (
              <ul className="space-y-2">
                {suspensions.map((x) => (
                  <li key={x.id} className="card p-4 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold">{REASON_TEXT[x.reason]}</p>
                      <span
                        className={`badge text-xs shrink-0 ${
                          x.status === 'active'
                            ? 'bg-ember-500/10 text-ember-700'
                            : 'bg-pitch-50 text-pitch-600'
                        }`}
                      >
                        {x.status === 'active'
                          ? 'Serving'
                          : x.status === 'served'
                            ? 'Served'
                            : 'Cancelled'}
                      </span>
                    </div>
                    <p className="text-sm text-pitch-800">
                      Banned for {x.matches_banned} {x.matches_banned === 1 ? 'match' : 'matches'}
                      {x.status === 'active'
                        ? `, ${x.matches_served} served, ${x.matches_remaining} to go`
                        : x.status === 'served'
                          ? ', all served'
                          : `, ${x.matches_served} served before it was cancelled`}
                      {x.competition_name ? ` (${x.competition_name})` : ' (any competition)'}
                    </p>
                    {x.source_label && (
                      <p className="text-sm text-pitch-600">Card shown in {x.source_label}</p>
                    )}
                    {x.notes && <p className="text-sm text-pitch-600">{x.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg">Game-by-game record</h2>
            {!recordLoaded ? (
              <LoadingBlock />
            ) : recordFailed ? (
              <div className="card p-4 text-pitch-600">
                The match record could not be loaded. Check your connection and try again.
              </div>
            ) : games.length === 0 ? (
              <div className="card p-6 text-center text-pitch-600">
                No finished, published games on record for this player yet.
              </div>
            ) : (
              <ul className="space-y-2">
                {games.map((g) => (
                  <li key={g.matchId} className="card p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {g.homeName} {g.homeScore ?? '–'} : {g.awayScore ?? '–'} {g.awayName}
                        </p>
                        <p className="text-sm text-pitch-600">
                          {formatKickoff(g.kickoffAt)}
                          {g.competition ? ` · ${g.competition}` : ''}
                          {g.venue ? ` · ${g.venue}` : ''}
                        </p>
                        <p className="text-xs text-pitch-600">Played for {g.teamName}</p>
                      </div>
                      {g.result && (
                        <span
                          className={`badge text-xs shrink-0 ${RESULT_STYLE[g.result]}`}
                          title={RESULT_TEXT[g.result]}
                        >
                          {RESULT_TEXT[g.result]}
                        </span>
                      )}
                    </div>
                    {g.events.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {g.events.map((e) => (
                          <span key={e.id} className={`badge text-xs ${EVENT_STYLE[e.event_type]}`}>
                            {EVENT_TEXT[e.event_type]}
                            {e.minute !== null ? ` ${e.minute}'` : ''}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-pitch-600">No goals or cards.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-pitch-600">
              Games are counted for every finished, published match played by the
              player&rsquo;s team while registered. Match-day squads are not recorded yet, so a game
              missed through injury or suspension may still be listed.
            </p>
          </section>

          <section className="card p-5 space-y-3">
            <h2 className="font-display font-bold text-lg">Photo</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <Camera className="w-4 h-4" aria-hidden />
                )}
                {player.photo_path ? 'Change photo' : 'Add photo'}
              </button>
              {player.photo_path && (
                <button type="button" className="btn-secondary" disabled={busy} onClick={onRemove}>
                  <Trash2 className="w-4 h-4" aria-hidden /> Remove photo
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                onChange={onPhotoChosen}
              />
            </div>
            <p className="text-sm text-pitch-600">
              Choose a clear photo of the player&rsquo;s face. It is shrunk automatically, so it is
              fine to use a photo straight from the camera. Only upload a photo with the
              player&rsquo;s permission, or a parent&rsquo;s if the player is under 18. Photos are
              private and can only be seen by signed-in club managers and administrators.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg">Registration history</h2>
            {history.length === 0 ? (
              <div className="card p-6 text-center text-pitch-600">
                This player is not registered to a team yet.
              </div>
            ) : (
              <ul className="space-y-2">
                {history.map((h) => (
                  <li key={h.id} className="card p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{h.team}</p>
                      <p className="text-sm text-pitch-600">
                        {h.division}
                        {h.season ? `, ${h.season}` : ''}
                      </p>
                      <p className="text-xs text-pitch-600 mt-1">
                        From {formatDay(h.start_date)}
                        {h.end_date ? ` to ${formatDay(h.end_date)}` : ''}
                      </p>
                    </div>
                    <span className={`badge text-xs shrink-0 ${STATUS_STYLE[h.status]}`}>
                      {STATUS_TEXT[h.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
