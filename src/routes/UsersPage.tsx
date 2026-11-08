import { useCallback, useEffect, useState } from 'react';
import { UserCog, Loader2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/auth';
import type { Club, Role } from '@/lib/types';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock } from '@/components/ui';
import { errMsg } from '@/lib/util';

interface ProfileRow {
  id: string;
  full_name: string;
  role: Role;
  club_id: string | null;
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'public', label: 'Public viewer' },
  { value: 'club_manager', label: 'Club manager' },
  { value: 'referee', label: 'Referee' },
  { value: 'admin', label: 'Administrator' },
];

function UserRow({
  p,
  clubs,
  isMe,
  onSaved,
  onMessage,
}: {
  p: ProfileRow;
  clubs: Club[];
  isMe: boolean;
  onSaved: () => void;
  onMessage: (kind: 'ok' | 'err', msg: string) => void;
}) {
  const [role, setRole] = useState<Role>(p.role);
  const [clubId, setClubId] = useState(p.club_id ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = role !== p.role || (clubId || null) !== p.club_id;

  async function save() {
    if (role === 'club_manager' && !clubId) {
      return onMessage('err', 'Choose a club for a club manager.');
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('profiles')
      .update({ role, club_id: role === 'club_manager' ? clubId : null })
      .eq('id', p.id)
      .select('id');
    setSaving(false);
    if (error) return onMessage('err', errMsg(error));
    if (!data?.length) return onMessage('err', 'You are not allowed to change this user.');
    onMessage('ok', `${p.full_name || 'User'} updated.`);
    onSaved();
  }

  return (
    <li className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold truncate">{p.full_name || 'Unnamed user'}</p>
        {isMe && <span className="badge bg-gold-400/30 text-gold-600">You</span>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-pitch-800">Role</span>
          <select
            className="input mt-1"
            value={role}
            disabled={isMe}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {role === 'club_manager' && (
          <label className="block">
            <span className="text-sm font-medium text-pitch-800">Club</span>
            <select
              className="input mt-1"
              value={clubId}
              disabled={isMe}
              onChange={(e) => setClubId(e.target.value)}
            >
              <option value="">Choose a club…</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {isMe ? (
        <p className="text-xs text-pitch-600">You cannot change your own role.</p>
      ) : (
        <button className="btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Save className="w-4 h-4" aria-hidden />}
          Save
        </button>
      )}
    </li>
  );
}

export default function UsersPage() {
  const { session } = useAuth();
  const [people, setPeople] = useState<ProfileRow[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, role, club_id')
        .order('created_at', { ascending: false }),
      supabase.from('club').select('*').order('name'),
    ]);
    if (p.error || c.error) {
      setError('Could not load users. Check your connection and try again.');
    } else {
      setPeople((p.data ?? []) as ProfileRow[]);
      setClubs((c.data ?? []) as Club[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={UserCog}
        title="Users & roles"
        intro="Everyone who signs up starts as a public viewer. Promote them here to club manager, referee or administrator."
      />
      <ErrorNote message={error} />
      <SuccessNote message={ok} />
      {loading ? (
        <LoadingBlock />
      ) : (
        <ul className="space-y-3">
          {people.map((p) => (
            <UserRow
              key={`${p.id}-${p.role}-${p.club_id}`}
              p={p}
              clubs={clubs}
              isMe={p.id === session?.user.id}
              onSaved={load}
              onMessage={(kind, msg) => {
                setError(kind === 'err' ? msg : null);
                setOk(kind === 'ok' ? msg : null);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
