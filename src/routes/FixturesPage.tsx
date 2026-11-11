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

/** Division name for a match (from nested competition.division, with fallbacks). */
function divisionLabel(m: MatchWithTeams): string {
  const div = m.competition?.division;
  if (div?.name) return div.name;
  if (m.competition?.name) return m.competition.name;
  return 'Unknown division';
}

function clubName(
  team: MatchWithTeams['home_team'] | undefined,
  fallback?: { name: string } | null
): string | null {
  return team?.club?.name ?? fallback?.name ?? null;
}

function MatchRow({ m }: { m: MatchWithTeams }) {
  const { date, time } = formatKickoff(m.kickoff_at);
  const hasScore = m.home_score != null && m.away_score != null;
  const homeClub = clubName(m.home_team, m.home_club);
  const awayClub = clubName(m.away_team, m.away_club);
  const division = divisionLabel(m);

  return (
    <li className="card p-4 hover:border-pitch-300 transition-colors">
      {/* Division / competition label — easy to read on a phone */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-pitch-800 text-white text-xs font-bold px-2.5 py-1">
          {division}
        </span>
        {m.competition?.name && m.competition.name !== division && (
          <span className="text-xs text-pitch-600 truncate">{m.competition.name}</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-right">
          <p className="font-semibold truncate">{m.home_team?.name ?? 'Home'}</p>
          {homeClub && (
            <p className="text-xs text-pitch-500 truncate">{homeClub}</p>
          )}
        </div>

        <div className="flex flex-col items-center px-3 shrink-0">
          {hasScore ? (
            <span className="font-display font-extrabold text-xl tabular-nums">
              {m.home_score} <span className="text-pitch-400">-</span> {m.away_score}
            </span>
          ) : (
            <span className="font-display font-bold text-sm text-pitch-500">{time}</span>
          )}
          <div className="mt-1">
            <StatusBadge status={m.status} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate">{m.away_team?.name ?? 'Away'}</p>
          {awayClub && (
            <p className="text-xs text-pitch-500 truncate">{awayClub}</p>
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

interface DivisionGroup {
  key: string;
  label: string;
  level: number;
  matches: MatchWithTeams[];
}

function groupByDivision(list: MatchWithTeams[]): DivisionGroup[] {
  const map = new Map<string, DivisionGroup>();
  for (const m of list) {
    const div = m.competition?.division;
    const key = div?.id ?? m.competition?.division_id ?? m.competition_id ?? 'unknown';
    const label = divisionLabel(m);
    const level = div?.level ?? 99;
    let g = map.get(key);
    if (!g) {
      g = { key, label, level, matches: [] };
      map.set(key, g);
    }
    g.matches.push(m);
  }
  return Array.from(map.values()).sort(
    (a, b) => a.level - b.level || a.label.localeCompare(b.label)
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
      // Pull division name + club names so each card can show “Men’s A” etc.
      const { data, error } = await supabase
        .from('match')
        .select(
          `
          id, competition_id, home_team_id, away_team_id, kickoff_at, venue,
          status, home_score, away_score, published, created_at,
          home_team:home_team_id(id, name, club_id, club:club_id(id, name)),
          away_team:away_team_id(id, name, club_id, club:club_id(id, name)),
          competition:competition_id(
            id, name, division_id,
            division:division_id(id, name, level)
          )
        `
        )
        .eq('published', true)
        .order('kickoff_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        setError('Could not load matches. Check your connection and try again.');
        console.error(error);
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
  const groups = useMemo(() => groupByDivision(shown), [shown]);

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
        Matches grouped by division so you can see which competition each game belongs to.
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

      {!loading && !error && groups.length > 0 && (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`div-${g.key}`}>
              <h2
                id={`div-${g.key}`}
                className="font-display font-bold text-lg text-pitch-900 mb-2 flex items-center gap-2"
              >
                <span className="inline-block w-1.5 h-5 rounded-full bg-pitch-600" aria-hidden />
                {g.label}
                <span className="text-sm font-normal text-pitch-500">
                  ({g.matches.length})
                </span>
              </h2>
              <ul className="space-y-2">
                {g.matches.map((m) => (
                  <MatchRow key={m.id} m={m} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
