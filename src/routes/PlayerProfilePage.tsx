import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, Loader2, Trash2, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock } from '@/components/ui';
import PlayerAvatar from '@/components/PlayerAvatar';
import { removePlayerPhoto, uploadPlayerPhoto, usePlayerPhotoUrls } from '@/lib/photos';
import { calcAge, errMsg, formatDay, one } from '@/lib/util';

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
  status: 'active' | 'ended' | 'suspended';
  start_date: string;
  end_date: string | null;
  team: string;
  division: string;
  season: string;
}

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
  const fileInput = useRef<HTMLInputElement>(null);

  const [player, setPlayer] = useState<Player | null>(null);
  const [history, setHistory] = useState<RegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banLeft, setBanLeft] = useState<number | null>(null);

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
          'id, status, start_date, end_date, team:team_id(name), division:division_id(name), season:season_id(name)'
        )
        .eq('player_id', id)
        .order('created_at', { ascending: false }),
    ]);

    // Best effort: a failure here must never stop the profile from showing.
    const susRes = await supabase.rpc('my_suspensions');
    if (!susRes.error) {
      const mine = ((susRes.data ?? []) as { player_id: string; status: string; matches_remaining: number }[]).filter(
        (s) => s.player_id === id && s.status === 'active'
      );
      setBanLeft(mine.length ? Math.max(...mine.map((s) => s.matches_remaining)) : null);
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
    setHistory(
      ((regRes.data ?? []) as unknown[]).map((r) => {
        const row = r as {
          id: string;
          status: RegistrationItem['status'];
          start_date: string;
          end_date: string | null;
          team: { name: string } | { name: string }[] | null;
          division: { name: string } | { name: string }[] | null;
          season: { name: string } | { name: string }[] | null;
        };
        return {
          id: row.id,
          status: row.status,
          start_date: row.start_date,
          end_date: row.end_date,
          team: one(row.team)?.name ?? 'Unknown team',
          division: one(row.division)?.name ?? 'Unknown division',
          season: one(row.season)?.name ?? '',
        };
      })
    );
    setLoading(false);
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

  const current = history.find((h) => h.status === 'active' || h.status === 'suspended');

  return (
    <div className="space-y-6">
      <PageHeader icon={UserRound} title="Player profile" backTo="/players" backLabel="Players" />

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
