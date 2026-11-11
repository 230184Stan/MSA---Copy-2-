import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Plus, ShieldAlert, Trash2, ClipboardList } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock, Field } from '@/components/ui';
import PlayerAvatar from '@/components/PlayerAvatar';
import { usePlayerPhotoUrls } from '@/lib/photos';
import { errMsg, formatKickoff, one } from '@/lib/util';

type EventType = 'goal' | 'yellow_card' | 'red_card' | 'substitution';

interface MatchInfo {
  id: string;
  kickoff_at: string;
  venue: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  competition: { name: string } | null;
}

interface RosterRow {
  registration_id: string;
  player_id: string;
  player_name: string;
  photo_path: string | null;
  team_id: string;
  team_name: string;
  side: 'home' | 'away';
  suspended: boolean;
  matches_remaining: number;
}

interface EventRow {
  id: string;
  event_type: EventType;
  minute: number | null;
  registration_id: string | null;
  created_at: string;
}

const EVENT_LABEL: Record<EventType, string> = {
  goal: 'Goal',
  yellow_card: 'Yellow card',
  red_card: 'Red card',
  substitution: 'Substitution',
};

const EVENT_STYLE: Record<EventType, string> = {
  goal: 'bg-pitch-100 text-pitch-700',
  yellow_card: 'bg-gold-400/30 text-gold-600',
  red_card: 'bg-ember-500/10 text-ember-700',
  substitution: 'bg-pitch-50 text-pitch-600',
};

export default function MatchEventsPage() {
  const { id } = useParams<{ id: string }>();

  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [side, setSide] = useState<'home' | 'away'>('home');
  const [registrationId, setRegistrationId] = useState('');
  const [eventType, setEventType] = useState<'goal' | 'yellow_card' | 'red_card'>('yellow_card');
  const [minute, setMinute] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const photoUrls = usePlayerPhotoUrls(
    roster.map((r) => ({ id: r.player_id, photo_path: r.photo_path }))
  );

  const load = useCallback(async () => {
    if (!id) return;
    const [matchRes, rosterRes, eventRes] = await Promise.all([
      supabase
        .from('match')
        .select(
          'id, kickoff_at, venue, status, home_score, away_score, home_team:home_team_id(name), away_team:away_team_id(name), competition:competition_id(name)'
        )
        .eq('id', id)
        .maybeSingle(),
      supabase.rpc('match_roster', { p_match_id: id }),
      supabase
        .from('match_event')
        .select('id, event_type, minute, registration_id, created_at')
        .eq('match_id', id)
        .order('created_at', { ascending: true }),
    ]);

    if (matchRes.error || rosterRes.error || eventRes.error) {
      setError('Could not load this match. Check your connection and try again.');
      setLoading(false);
      return;
    }
    if (!matchRes.data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const row = matchRes.data as unknown as Record<string, unknown>;
    setMatch({
      ...(row as unknown as MatchInfo),
      home_team: one(row.home_team as { name: string } | { name: string }[] | null),
      away_team: one(row.away_team as { name: string } | { name: string }[] | null),
      competition: one(row.competition as { name: string } | { name: string }[] | null),
    });
    setRoster((rosterRes.data ?? []) as RosterRow[]);
    setEvents((eventRes.data ?? []) as EventRow[]);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const sidePlayers = useMemo(() => roster.filter((r) => r.side === side), [roster, side]);
  const chosen = roster.find((r) => r.registration_id === registrationId);
  const byRegistration = useMemo(() => {
    const map = new Map<string, RosterRow>();
    for (const r of roster) map.set(r.registration_id, r);
    return map;
  }, [roster]);

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!id) return;
    if (!registrationId) return setError('Choose the player.');
    let minuteValue: number | null = null;
    if (minute.trim() !== '') {
      minuteValue = Number(minute);
      if (!Number.isInteger(minuteValue) || minuteValue < 0 || minuteValue > 150) {
        return setError('The minute must be a whole number from 0 to 150, or left empty.');
      }
    }
    setBusy(true);
    const { error: err } = await supabase.from('match_event').insert({
      match_id: id,
      registration_id: registrationId,
      event_type: eventType,
      minute: minuteValue,
    });
    setBusy(false);
    if (err) return setError(errMsg(err, 'Could not record that.'));
    setOk(
      eventType === 'red_card'
        ? 'Red card recorded. The player is suspended automatically.'
        : `${EVENT_LABEL[eventType]} recorded.`
    );
    setRegistrationId('');
    setMinute('');
    await load();
  }

  async function removeEvent(eventId: string) {
    setError(null);
    setOk(null);
    setBusy(true);
    const { error: err } = await supabase.from('match_event').delete().eq('id', eventId);
    setBusy(false);
    setConfirmDelete(null);
    if (err) return setError(errMsg(err, 'Could not remove that.'));
    setOk('Removed. If it was a card that caused a suspension, the suspension is cancelled.');
    await load();
  }

  const homeName = match?.home_team?.name ?? 'Home';
  const awayName = match?.away_team?.name ?? 'Away';

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        title="Goals and cards"
        backTo="/matches/manage"
        backLabel="Match results"
      />

      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      {loading && <LoadingBlock />}

      {!loading && notFound && (
        <div className="card p-6 text-center text-pitch-700">
          This match could not be found, or you are not assigned to it.
        </div>
      )}

      {!loading && match && (
        <>
          <section className="card p-4 space-y-1">
            <p className="text-xs text-pitch-600">
              {match.competition?.name} · {formatKickoff(match.kickoff_at)}
              {match.venue ? ` · ${match.venue}` : ''}
            </p>
            <p className="font-display font-bold text-xl">
              {homeName}{' '}
              <span className="text-pitch-600">
                {match.home_score ?? '-'} : {match.away_score ?? '-'}
              </span>{' '}
              {awayName}
            </p>
          </section>

          {roster.length === 0 ? (
            <div className="card p-6 text-center text-pitch-700">
              No registered players were found for these teams, or you are not assigned to this
              match.
            </div>
          ) : (
            <>
              <section className="card p-4 space-y-4">
                <h2 className="font-display font-bold text-lg">Record a goal or card</h2>
                <form onSubmit={addEvent} className="space-y-4">
                  <Field label="What happened?">
                    <select
                      className="input"
                      value={eventType}
                      onChange={(e) =>
                        setEventType(e.target.value as 'goal' | 'yellow_card' | 'red_card')
                      }
                    >
                      <option value="yellow_card">Yellow card</option>
                      <option value="red_card">Red card (including a second yellow)</option>
                      <option value="goal">Goal</option>
                    </select>
                  </Field>
                  <Field label="Team">
                    <select
                      className="input"
                      value={side}
                      onChange={(e) => {
                        setSide(e.target.value as 'home' | 'away');
                        setRegistrationId('');
                      }}
                    >
                      <option value="home">{homeName} (home)</option>
                      <option value="away">{awayName} (away)</option>
                    </select>
                  </Field>
                  <Field label="Player">
                    <select
                      className="input"
                      value={registrationId}
                      onChange={(e) => setRegistrationId(e.target.value)}
                    >
                      <option value="">Choose a player</option>
                      {sidePlayers.map((r) => (
                        <option key={r.registration_id} value={r.registration_id}>
                          {r.player_name}
                          {r.suspended ? ' (suspended)' : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {chosen?.suspended && (
                    <div className="card p-3 border-ember-500 bg-ember-500/10 text-sm text-ember-700 flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                      <span>
                        {chosen.player_name} is suspended ({chosen.matches_remaining}{' '}
                        {chosen.matches_remaining === 1 ? 'match' : 'matches'} left) and should not
                        be playing. Check the player is who they say they are.
                      </span>
                    </div>
                  )}
                  <Field label="Minute (optional)">
                    <input
                      className="input !w-28"
                      inputMode="numeric"
                      value={minute}
                      onChange={(e) => setMinute(e.target.value.replace(/\D/g, '').slice(0, 3))}
                      placeholder="e.g. 54"
                    />
                  </Field>
                  <button className="btn-primary w-full sm:w-auto" disabled={busy}>
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="w-4 h-4" aria-hidden />
                    )}
                    Record
                  </button>
                </form>
              </section>

              <section className="space-y-3">
                <h2 className="font-display font-bold text-lg">Recorded so far</h2>
                {events.length === 0 ? (
                  <div className="card p-6 text-center text-pitch-600">Nothing recorded yet.</div>
                ) : (
                  <ul className="space-y-2">
                    {events.map((ev) => {
                      const who = ev.registration_id ? byRegistration.get(ev.registration_id) : null;
                      return (
                        <li key={ev.id} className="card p-3 flex items-center gap-3">
                          <span className={`badge text-xs shrink-0 ${EVENT_STYLE[ev.event_type]}`}>
                            {EVENT_LABEL[ev.event_type]}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{who?.player_name ?? 'Unknown player'}</p>
                            <p className="text-xs text-pitch-600 truncate">
                              {who?.team_name}
                              {ev.minute != null ? `, minute ${ev.minute}` : ''}
                            </p>
                          </div>
                          {confirmDelete === ev.id ? (
                            <div className="flex gap-2 shrink-0">
                              <button
                                className="btn-primary"
                                disabled={busy}
                                onClick={() => removeEvent(ev.id)}
                              >
                                Remove
                              </button>
                              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>
                                Keep
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn-secondary shrink-0"
                              aria-label={`Remove ${EVENT_LABEL[ev.event_type]} for ${who?.player_name ?? 'player'}`}
                              onClick={() => setConfirmDelete(ev.id)}
                            >
                              <Trash2 className="w-4 h-4" aria-hidden />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="space-y-3">
                <h2 className="font-display font-bold text-lg">Squads</h2>
                <p className="text-sm text-pitch-600">
                  Everyone currently registered to each team, with photos to help check who is who.
                </p>
                {(['home', 'away'] as const).map((s) => (
                  <div key={s} className="card p-4 space-y-3">
                    <h3 className="font-semibold">{s === 'home' ? homeName : awayName}</h3>
                    {!roster.some((r) => r.side === s) && (
                      <p className="text-sm text-pitch-600">
                        No players are registered to this team yet. Register them from the Players
                        page, and make sure they are on this exact team.
                      </p>
                    )}
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {roster
                        .filter((r) => r.side === s)
                        .map((r) => (
                          <li key={r.registration_id} className="flex items-center gap-3 min-w-0">
                            <PlayerAvatar
                              name={r.player_name}
                              url={photoUrls[r.player_id]}
                              size="sm"
                            />
                            <span className="truncate">{r.player_name}</span>
                            {r.suspended && (
                              <span className="badge text-xs bg-ember-500/10 text-ember-700 shrink-0">
                                Suspended
                              </span>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
