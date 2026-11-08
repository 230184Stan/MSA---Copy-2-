import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ArrowRightLeft, Check, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/auth';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock, Field } from '@/components/ui';
import { errMsg, one } from '@/lib/util';

type MoveType = 'up' | 'down' | 'transfer';

interface MoveRow {
  id: string;
  status: 'requested' | 'club_approved' | 'completed' | 'rejected' | 'admin_approved';
  move_type: MoveType;
  reason: string | null;
  rejected_reason: string | null;
  created_at: string;
  player_id: string;
  player_name: string;
  from_team_name: string | null;
  from_club_name: string | null;
  from_division_name: string | null;
  to_team_name: string | null;
  to_club_name: string | null;
  to_division_name: string | null;
  can_approve: boolean;
  can_reject: boolean;
}

interface PlayerOption {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  divisionName: string;
}

interface TeamOption {
  id: string;
  name: string;
  clubName: string;
  divisionName: string;
}

const STATUS_TEXT: Record<string, string> = {
  requested: 'Waiting for the receiving club',
  club_approved: 'Waiting for the association',
  admin_approved: 'Waiting for the association',
  completed: 'Done',
  rejected: 'Rejected',
};

const STATUS_STYLE: Record<string, string> = {
  requested: 'bg-gold-400/20 text-gold-600',
  club_approved: 'bg-gold-400/20 text-gold-600',
  admin_approved: 'bg-gold-400/20 text-gold-600',
  completed: 'bg-pitch-100 text-pitch-700',
  rejected: 'bg-ember-500/10 text-ember-700',
};

const TYPE_TEXT: Record<MoveType, string> = {
  up: 'Move up',
  down: 'Move down',
  transfer: 'Transfer',
};

const isPending = (m: MoveRow) => m.status === 'requested' || m.status === 'club_approved';

export default function MovesPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [windowOpen, setWindowOpen] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [form, setForm] = useState({ playerId: '', teamId: '', reason: '' });
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    const [movesRes, regRes, teamRes, seasonRes] = await Promise.all([
      supabase.rpc('my_division_moves'),
      supabase
        .from('registration')
        .select('player:player_id(id, full_name), team:team_id(id, name), division:division_id(name)')
        .eq('status', 'active'),
      supabase
        .from('team')
        .select('id, name, club:club_id(name), division:division_id(name)')
        .not('division_id', 'is', null)
        .order('name'),
      supabase.from('season').select('id').eq('is_current', true).maybeSingle(),
    ]);

    if (movesRes.error || regRes.error || teamRes.error) {
      setError('Could not load moves. Check your connection and try again.');
      setLoading(false);
      return;
    }

    setMoves((movesRes.data ?? []) as MoveRow[]);

    const playerOptions: PlayerOption[] = [];
    for (const r of (regRes.data ?? []) as unknown[]) {
      const row = r as {
        player: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
        team: { id: string; name: string } | { id: string; name: string }[] | null;
        division: { name: string } | { name: string }[] | null;
      };
      const p = one(row.player);
      const t = one(row.team);
      if (!p || !t) continue;
      playerOptions.push({
        playerId: p.id,
        name: p.full_name,
        teamId: t.id,
        teamName: t.name,
        divisionName: one(row.division)?.name ?? 'No division',
      });
    }
    playerOptions.sort((a, b) => a.name.localeCompare(b.name));
    setPlayers(playerOptions);

    setTeams(
      ((teamRes.data ?? []) as unknown[]).map((r) => {
        const row = r as {
          id: string;
          name: string;
          club: { name: string } | { name: string }[] | null;
          division: { name: string } | { name: string }[] | null;
        };
        return {
          id: row.id,
          name: row.name,
          clubName: one(row.club)?.name ?? '',
          divisionName: one(row.division)?.name ?? '',
        };
      })
    );

    const seasonId = (seasonRes.data as { id: string } | null)?.id;
    if (seasonId) {
      const w = await supabase
        .from('transfer_window')
        .select('opens_on, closes_on')
        .eq('season_id', seasonId);
      const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
      setWindowOpen(
        ((w.data ?? []) as { opens_on: string; closes_on: string }[]).some(
          (x) => x.opens_on <= today && today <= x.closes_on
        )
      );
    } else {
      setWindowOpen(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedPlayer = players.find((p) => p.playerId === form.playerId);
  const visiblePlayers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? players.filter((p) => p.name.toLowerCase().includes(q)) : players;
  }, [players, filter]);
  const targetTeams = teams.filter((t) => t.id !== selectedPlayer?.teamId);

  async function requestMove(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!form.playerId) return setError('Choose a player.');
    if (!form.teamId) return setError('Choose the team the player is moving to.');
    setBusy('request');
    const { error: err } = await supabase.rpc('request_division_move', {
      p_player_id: form.playerId,
      p_to_team_id: form.teamId,
      p_reason: form.reason.trim() || null,
    });
    setBusy(null);
    if (err) return setError(errMsg(err));
    setOk('Move requested. You can follow it in the list below.');
    setForm({ playerId: '', teamId: '', reason: '' });
    setFilter('');
    await load();
  }

  async function approve(m: MoveRow) {
    setError(null);
    setOk(null);
    setBusy(m.id);
    const { data, error: err } = await supabase.rpc('approve_division_move', { p_move_id: m.id });
    setBusy(null);
    if (err) return setError(errMsg(err));
    setOk(
      data === 'completed'
        ? `${m.player_name} has been moved.`
        : `Approved. ${m.player_name}'s move now waits for the association.`
    );
    await load();
  }

  async function confirmReject() {
    if (!rejecting) return;
    setError(null);
    setOk(null);
    setBusy(rejecting.id);
    const { error: err } = await supabase.rpc('reject_division_move', {
      p_move_id: rejecting.id,
      p_reason: rejecting.reason,
    });
    setBusy(null);
    if (err) return setError(errMsg(err));
    setOk('Move rejected.');
    setRejecting(null);
    await load();
  }

  const pending = moves.filter(isPending);
  const history = moves.filter((m) => !isPending(m));

  function MoveCard({ m }: { m: MoveRow }) {
    const working = busy === m.id;
    return (
      <li className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{m.player_name}</p>
            <p className="text-sm text-pitch-600">{TYPE_TEXT[m.move_type]}</p>
          </div>
          <span className={`badge text-xs shrink-0 ${STATUS_STYLE[m.status] ?? ''}`}>
            {STATUS_TEXT[m.status] ?? m.status}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate">{m.from_team_name}</p>
            <p className="text-pitch-600 truncate">
              {m.from_club_name}, {m.from_division_name}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-pitch-400 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 text-right">
            <p className="font-medium truncate">{m.to_team_name}</p>
            <p className="text-pitch-600 truncate">
              {m.to_club_name}, {m.to_division_name}
            </p>
          </div>
        </div>

        {m.reason && <p className="text-sm text-pitch-700">Reason: {m.reason}</p>}
        {m.rejected_reason && (
          <p className="text-sm text-ember-700">Rejected because: {m.rejected_reason}</p>
        )}

        {(m.can_approve || m.can_reject) && rejecting?.id !== m.id && (
          <div className="flex flex-wrap gap-2">
            {m.can_approve && (
              <button className="btn-primary" disabled={working} onClick={() => approve(m)}>
                {working ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="w-4 h-4" aria-hidden />
                )}
                {isAdmin ? 'Approve and complete move' : 'Approve incoming player'}
              </button>
            )}
            {m.can_reject && (
              <button
                className="btn-secondary"
                disabled={working}
                onClick={() => setRejecting({ id: m.id, reason: '' })}
              >
                <X className="w-4 h-4" aria-hidden /> Reject
              </button>
            )}
          </div>
        )}

        {rejecting?.id === m.id && (
          <div className="space-y-2">
            <Field label="Why are you rejecting this move?">
              <input
                className="input"
                value={rejecting.reason}
                onChange={(e) => setRejecting({ id: m.id, reason: e.target.value })}
                placeholder="Give a short reason"
                autoFocus
              />
            </Field>
            <div className="flex gap-2">
              <button
                className="btn-primary"
                disabled={working || !rejecting.reason.trim()}
                onClick={confirmReject}
              >
                {working && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                Confirm rejection
              </button>
              <button className="btn-secondary" onClick={() => setRejecting(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ArrowRightLeft}
        title="Division moves"
        intro="A player is in one division at a time. Moving them ends the old registration and starts a new one once everyone has approved."
      />

      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          {windowOpen !== null && (
            <div
              className={`card p-3 text-sm ${
                windowOpen ? 'border-pitch-300 bg-pitch-50 text-pitch-800' : 'border-gold-500 bg-gold-400/10 text-pitch-800'
              }`}
            >
              {windowOpen
                ? 'The transfer window is open.'
                : isAdmin
                ? 'The transfer window is closed. You can still request a move, but you must give a reason.'
                : 'The transfer window is closed. Only an administrator can arrange an exceptional move.'}
            </div>
          )}
          {windowOpen === null && (
            <div className="card p-3 text-sm border-gold-500 bg-gold-400/10 text-pitch-800">
              No current season is set, so moves cannot be requested yet.
            </div>
          )}

          <section className="card p-4 space-y-4">
            <h2 className="font-display font-bold text-lg">Request a move</h2>
            <form onSubmit={requestMove} className="space-y-4">
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
                  onChange={(e) => setForm({ ...form, playerId: e.target.value, teamId: '' })}
                >
                  <option value="">Choose a player</option>
                  {visiblePlayers.map((p) => (
                    <option key={p.playerId} value={p.playerId}>
                      {p.name}, {p.teamName} ({p.divisionName})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Moving to">
                <select
                  className="input"
                  value={form.teamId}
                  disabled={!form.playerId}
                  onChange={(e) => setForm({ ...form, teamId: e.target.value })}
                >
                  <option value="">{form.playerId ? 'Choose a team' : 'Choose a player first'}</option>
                  {targetTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.clubName}, {t.name} ({t.divisionName})
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Reason"
                hint="Needed when moving down a division, or when the transfer window is closed."
              >
                <input
                  className="input"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="For example: returning from injury"
                />
              </Field>
              <button className="btn-primary w-full sm:w-auto" disabled={busy === 'request'}>
                {busy === 'request' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                Request move
              </button>
            </form>
          </section>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg">In progress</h2>
            {pending.length === 0 ? (
              <div className="card p-6 text-center text-pitch-600">
                No moves in progress. Request one above.
              </div>
            ) : (
              <ul className="space-y-3">
                {pending.map((m) => (
                  <MoveCard key={m.id} m={m} />
                ))}
              </ul>
            )}
          </section>

          {history.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display font-bold text-lg">Finished</h2>
              <ul className="space-y-3">
                {history.map((m) => (
                  <MoveCard key={m.id} m={m} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
