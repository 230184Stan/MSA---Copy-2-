import { useCallback, useEffect, useState } from 'react';
import { Flag, Loader2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/auth';
import { PageHeader, ErrorNote, LoadingBlock } from '@/components/ui';
import { errMsg, one, formatKickoff } from '@/lib/util';

interface MatchData {
  id: string;
  kickoff_at: string;
  venue: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  published: boolean;
  referee_id: string | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  competition: { name: string } | null;
}
interface Referee {
  id: string;
  full_name: string;
}

const STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'live', label: 'Live' },
  { value: 'completed', label: 'Completed' },
  { value: 'postponed', label: 'Postponed' },
  { value: 'forfeit', label: 'Forfeit' },
];

function MatchCard({
  m,
  isAdmin,
  referees,
  onSaved,
}: {
  m: MatchData;
  isAdmin: boolean;
  referees: Referee[];
  onSaved: () => void;
}) {
  const [hs, setHs] = useState(m.home_score?.toString() ?? '');
  const [aw, setAw] = useState(m.away_score?.toString() ?? '');
  const [status, setStatus] = useState(m.status);
  const [published, setPublished] = useState(m.published);
  const [refId, setRefId] = useState(m.referee_id ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setErr(null);
    setSaved(false);
    const needsScore = status === 'completed' || status === 'forfeit';
    const parse = (v: string) => (v.trim() === '' ? null : Number(v));
    const h = parse(hs);
    const a = parse(aw);
    const bad = (n: number | null) => n !== null && (!Number.isInteger(n) || n < 0 || n > 99);
    if (bad(h) || bad(a)) return setErr('Scores must be whole numbers from 0 to 99.');
    if (needsScore && (h === null || a === null)) {
      return setErr('Enter both scores before marking the match completed.');
    }
    if (!needsScore && status === 'scheduled' && (h !== null || a !== null)) {
      return setErr('A match with a score should be Live or Completed, not Scheduled.');
    }
    // Referees may only send scores + status; the database rejects anything else.
    const payload: Record<string, unknown> = { home_score: h, away_score: a, status };
    if (isAdmin) {
      payload.published = published;
      payload.referee_id = refId || null;
    }
    setSaving(true);
    const { data, error } = await supabase.from('match').update(payload).eq('id', m.id).select('id');
    setSaving(false);
    if (error) return setErr(errMsg(error));
    if (!data || data.length === 0) return setErr('You are not allowed to change this match.');
    setSaved(true);
    onSaved();
  }

  return (
    <article className="card p-4 space-y-3">
      <div>
        <p className="text-xs text-pitch-600">
          {m.competition?.name} · {formatKickoff(m.kickoff_at)}
          {m.venue ? ` · ${m.venue}` : ''}
        </p>
        <div className="mt-2 grid grid-cols-[1fr_auto_auto_auto_1fr] items-center gap-2">
          <span className="font-semibold text-right truncate">{m.home_team?.name ?? 'Home'}</span>
          <input
            inputMode="numeric"
            className="input !w-16 text-center text-lg font-bold"
            value={hs}
            onChange={(e) => setHs(e.target.value.replace(/\D/g, '').slice(0, 2))}
            aria-label={`${m.home_team?.name ?? 'Home'} score`}
          />
          <span className="text-pitch-500 font-bold">-</span>
          <input
            inputMode="numeric"
            className="input !w-16 text-center text-lg font-bold"
            value={aw}
            onChange={(e) => setAw(e.target.value.replace(/\D/g, '').slice(0, 2))}
            aria-label={`${m.away_team?.name ?? 'Away'} score`}
          />
          <span className="font-semibold truncate">{m.away_team?.name ?? 'Away'}</span>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-pitch-800">Status</span>
          <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {isAdmin && (
          <label className="block">
            <span className="text-sm font-medium text-pitch-800">Referee</span>
            <select className="input mt-1" value={refId} onChange={(e) => setRefId(e.target.value)}>
              <option value="">Not assigned</option>
              {referees.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name || 'Unnamed referee'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {isAdmin && (
        <label className="flex items-center gap-2 min-h-[44px] text-sm">
          <input
            type="checkbox"
            className="w-5 h-5"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          Show this match on the public site
        </label>
      )}

      <ErrorNote message={err} />
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Save className="w-4 h-4" aria-hidden />}
          Save result
        </button>
        {saved && <span className="text-sm text-pitch-700 font-medium">Saved ✓</span>}
      </div>
    </article>
  );
}

export default function ResultsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [matches, setMatches] = useState<MatchData[]>([]);
  const [referees, setReferees] = useState<Referee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'todo' | 'done'>('todo');

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('match')
      .select(
        'id, kickoff_at, venue, status, home_score, away_score, published, referee_id, home_team:home_team_id(name), away_team:away_team_id(name), competition:competition_id(name)'
      )
      .order('kickoff_at', { ascending: true });
    if (err) {
      setError('Could not load matches. Check your connection and try again.');
    } else {
      setMatches(
        ((data ?? []) as unknown[]).map((r) => {
          const row = r as Record<string, unknown>;
          return {
            ...(row as unknown as MatchData),
            home_team: one(row.home_team as { name: string } | { name: string }[] | null),
            away_team: one(row.away_team as { name: string } | { name: string }[] | null),
            competition: one(row.competition as { name: string } | { name: string }[] | null),
          };
        })
      );
    }
    if (isAdmin) {
      const { data: refs } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'referee')
        .order('full_name');
      setReferees((refs ?? []) as Referee[]);
    }
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const todo = matches.filter((m) => ['scheduled', 'live', 'postponed'].includes(m.status));
  const done = matches
    .filter((m) => ['completed', 'forfeit'].includes(m.status))
    .reverse();
  const shown = tab === 'todo' ? todo : done;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Flag}
        title="Match results"
        intro={
          isAdmin
            ? 'Enter scores, assign referees, and choose which matches are public.'
            : 'Enter the score for matches assigned to you.'
        }
      />
      <ErrorNote message={error} />

      <div className="flex gap-2" role="tablist">
        {(['todo', 'done'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`btn flex-1 ${tab === t ? 'bg-pitch-600 text-white' : 'bg-white border border-pitch-200 text-pitch-800'}`}
          >
            {t === 'todo' ? `To score (${todo.length})` : `Completed (${done.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingBlock />
      ) : shown.length === 0 ? (
        <div className="card p-6 text-center text-pitch-600">
          {tab === 'todo'
            ? isAdmin
              ? 'No matches waiting for a result.'
              : 'No matches are assigned to you right now.'
            : 'No completed matches yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((m) => (
            // key includes status/score so the card resets after the list reloads
            <MatchCard
              key={`${m.id}-${m.status}-${m.home_score}-${m.away_score}-${m.published}-${m.referee_id}`}
              m={m}
              isAdmin={isAdmin}
              referees={referees}
              onSaved={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
