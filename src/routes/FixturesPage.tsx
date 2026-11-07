import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import type { MatchWithTeams, MatchStatus } from '@/lib/types';
import { ArrowLeft, Calendar, AlertCircle, MapPin, Clock } from 'lucide-react';

type Tab = 'fixtures' | 'results';

function formatKickoff(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }),
    time: d.toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  };
}

function StatusBadge({ status }: { status: MatchStatus }) {
  if (status === 'live')
    return <span className="badge bg-ember-500 text-white animate-pulse">Live</span>;
  if (status === 'completed')
    return <span className="badge bg-pitch-100 text-pitch-700">Full time</span>;
  if (status === 'postponed')
    return <span className="badge bg-amber-100 text-amber-700">Postponed</span>;
  if (status === 'forfeit')
    return <span className="badge bg-red-100 text-red-700">Forfeit</span>;
  return <span className="badge bg-pitch-100 text-pitch-600">Scheduled</span>;
}

function MatchRow({ m }: { m: MatchWithTeams }) {
  const { date, time } = formatKickoff(m.kickoff_at);
  const hasScore = m.home_score != null && m.away_score != null;

  return (
    <li className="card p-4 hover:border-pitch-300 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-right">
          <p className="font-semibold truncate">{m.home_team.name}</p>
          {m.home_club && (
            <p className="text-xs text-pitch-500 truncate">{m.home_club.name}</p>
          )}
        </div>

        <div className="flex flex-col items-center px-3 shrink-0">
          {hasScore ? (
            <span className="font-display font-extrabold text-xl tabular-nums">
              {m.home_score} <span className="text-pitch-400">-</span> {m.away_score}
            </span>
          ) : (
            <span className="font-display font-bold text-sm text-pitch-500">
              {time}
            </span>
          )}
          <div className="mt-1">
            <StatusBadge status={m.status} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate">{m.away_team.name}</p>
          {m.away_club && (
            <p className="text-xs text-pitch-500 truncate">{m.away_club.name}</p>
          )}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-pitch-100 flex flex-wrap gap-x-4 gap-y-1 text-xs text-pitch-600">
        <span className="inline-flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5" aria-hidden /> {date}
        </span>
        {m.venue && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" aria-hidden /> {m.venue}
          </span>
        )}
        {!hasScore && (
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" aria-hidden /> Kick-off {time}
          </span>
        )}
      </div>
    </li>
  );
}

export default function FixturesPage() {
  const [matches, setMatches] = useState<MatchWithTeams[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('fixtures');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('match')
        .select(
          'id, competition_id, home_team_id, away_team_id, kickoff_at, venue, status, home_score, away_score, published, created_at, home_team:home_team_id(id, name, club_id), away_team:away_team_id(id, name, club_id), competition:competition_id(id, name, division_id)'
        )
        .eq('published', true)
        .order('kickoff_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        setError('Could not load matches. Check your connection and try again.');
      } else {
        setMatches((data ?? []) as unknown as MatchWithTeams[]);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const fixtures = useMemo(
    () =>
      matches.filter((m) =>
        ['scheduled', 'live', 'postponed'].includes(m.status)
      ),
    [matches]
  );
  const results = useMemo(
    () =>
      matches
        .filter((m) => ['completed', 'forfeit'].includes(m.status))
        .sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at)),
    [matches]
  );

  const shown = tab === 'fixtures' ? fixtures : results;

  return (
    <div className="space-y-4">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-pitch-700 font-medium min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden /> Home
      </Link>

      <h1 className="font-display font-bold text-2xl">Fixtures &amp; Results</h1>
      <p className="text-pitch-700">
        All upcoming and finished matches across Madang competitions.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 bg-pitch-100 rounded-xl p-1 w-full sm:w-auto">
        <button
          onClick={() => setTab('fixtures')}
          className={`flex-1 px-4 py-2 rounded-lg font-semibold text-sm transition-colors min-h-[40px] ${
            tab === 'fixtures'
              ? 'bg-white text-pitch-800 shadow-sm'
              : 'text-pitch-600 hover:text-pitch-800'
          }`}
        >
          Fixtures ({fixtures.length})
        </button>
        <button
          onClick={() => setTab('results')}
          className={`flex-1 px-4 py-2 rounded-lg font-semibold text-sm transition-colors min-h-[40px] ${
            tab === 'results'
              ? 'bg-white text-pitch-800 shadow-sm'
              : 'text-pitch-600 hover:text-pitch-800'
          }`}
        >
          Results ({results.length})
        </button>
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-24 w-full" />
          ))}
        </div>
      )}

      {error && (
        <div className="card p-4 border-ember-500 bg-ember-500/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-ember-600 mt-0.5 shrink-0" aria-hidden />
          <p className="text-sm text-ember-700">{error}</p>
        </div>
      )}

      {!loading && !error && shown.length === 0 && (
        <div className="card p-6 text-center text-pitch-600">
          {tab === 'fixtures'
            ? 'No upcoming fixtures scheduled yet.'
            : 'No results to show yet.'}
        </div>
      )}

      {!loading && !error && shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map((m) => (
            <MatchRow key={m.id} m={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
