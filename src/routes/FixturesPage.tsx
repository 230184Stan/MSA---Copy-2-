import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import type { MatchStatus } from '@/lib/types';
import { ArrowLeft, Calendar, AlertCircle, MapPin, Clock } from 'lucide-react';
import DivisionFilter from '@/components/DivisionFilter';
import { sortDivisions, sortSeasons } from '@/lib/divisions';
import type { DivisionInfo, SeasonInfo } from '@/lib/divisions';
import { one } from '@/lib/util';

type Tab = 'fixtures' | 'results';

interface FixtureRow {
  id: string;
  kickoff_at: string;
  venue: string | null;
  status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
  home_team: { name: string; club: string | null };
  away_team: { name: string; club: string | null };
  competition: { id: string; name: string; season: SeasonInfo; division: DivisionInfo };
}

type Embedded<T> = T | T[] | null;

/** Supabase returns joined rows as objects or one-item arrays; flatten and drop incomplete rows. */
function toFixture(raw: unknown): FixtureRow | null {
  const r = raw as {
    id: string;
    kickoff_at: string;
    venue: string | null;
    status: MatchStatus;
    home_score: number | null;
    away_score: number | null;
    home_team: Embedded<{ name: string; club: Embedded<{ name: string }> }>;
    away_team: Embedded<{ name: string; club: Embedded<{ name: string }> }>;
    competition: Embedded<{
      id: string;
      name: string;
      season: Embedded<SeasonInfo>;
      division: Embedded<DivisionInfo>;
    }>;
  };
  const home = one(r.home_team);
  const away = one(r.away_team);
  const comp = one(r.competition);
  const season = comp ? one(comp.season) : null;
  const division = comp ? one(comp.division) : null;
  if (!home || !away || !comp || !season || !division) return null;
  return {
    id: r.id,
    kickoff_at: r.kickoff_at,
    venue: r.venue,
    status: r.status,
    home_score: r.home_score,
    away_score: r.away_score,
    home_team: { name: home.name, club: one(home.club)?.name ?? null },
    away_team: { name: away.name, club: one(away.club)?.name ?? null },
    competition: { id: comp.id, name: comp.name, season, division },
  };
}

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

function MatchRow({ m }: { m: FixtureRow }) {
  const { date, time } = formatKickoff(m.kickoff_at);
  const hasScore = m.home_score != null && m.away_score != null;

  return (
    <li className="card p-4 hover:border-pitch-300 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-right">
          <p className="font-semibold truncate">{m.home_team.name}</p>
          {m.home_team.club && (
            <p className="text-xs text-pitch-500 truncate">{m.home_team.club}</p>
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
          <p className="font-semibold truncate">{m.away_team.name}</p>
          {m.away_team.club && (
            <p className="text-xs text-pitch-500 truncate">{m.away_team.club}</p>
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
  const [rows, setRows] = useState<FixtureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('fixtures');
  const [seasonId, setSeasonId] = useState('');
  const [divisionId, setDivisionId] = useState('all');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('match')
        .select(
          'id, kickoff_at, venue, status, home_score, away_score, home_team:home_team_id(name, club:club_id(name)), away_team:away_team_id(name, club:club_id(name)), competition:competition_id(id, name, season:season_id(id, name, is_current), division:division_id(id, name, level))'
        )
        .eq('published', true)
        .order('kickoff_at', { ascending: true });
      if (cancelled) return;
      if (err) {
        setError('Could not load matches. Check your connection and try again.');
      } else {
        setRows(
          ((data ?? []) as unknown[])
            .map(toFixture)
            .filter((r): r is FixtureRow => r !== null)
        );
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const seasons = useMemo(() => sortSeasons(rows.map((r) => r.competition.season)), [rows]);
  const season = seasons.find((s) => s.id === seasonId) ?? seasons[0];
  const inSeason = useMemo(
    () => rows.filter((r) => r.competition.season.id === season?.id),
    [rows, season?.id]
  );

  const fixtures = useMemo(
    () => inSeason.filter((m) => ['scheduled', 'live', 'postponed'].includes(m.status)),
    [inSeason]
  );
  const results = useMemo(
    () =>
      inSeason
        .filter((m) => ['completed', 'forfeit'].includes(m.status))
        .sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at)),
    [inSeason]
  );
  const shown = tab === 'fixtures' ? fixtures : results;

  const divisions = useMemo(
    () => sortDivisions(inSeason.map((m) => m.competition.division)),
    [inSeason]
  );
  const options = divisions.map((d) => ({
    id: d.id,
    name: d.name,
    count: shown.filter((m) => m.competition.division.id === d.id).length,
  }));
  const activeDivision = divisions.some((d) => d.id === divisionId) ? divisionId : 'all';
  const visibleDivisions =
    activeDivision === 'all' ? divisions : divisions.filter((d) => d.id === activeDivision);

  const emptyText = tab === 'fixtures' ? 'No upcoming fixtures scheduled yet.' : 'No results to show yet.';

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
        Upcoming and finished matches, grouped by division
        {season ? ` for the ${season.name} season` : ''}.
      </p>

      {seasons.length > 1 && (
        <label className="block max-w-xs">
          <span className="text-sm font-medium text-pitch-800">Season</span>
          <select
            className="input mt-1"
            value={season?.id ?? ''}
            onChange={(e) => setSeasonId(e.target.value)}
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_current ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-pitch-100 rounded-xl p-1 w-full sm:w-auto">
        {(
          [
            ['fixtures', `Fixtures (${fixtures.length})`],
            ['results', `Results (${results.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 px-4 py-2 rounded-lg font-semibold text-sm transition-colors min-h-[40px] ${
              tab === key
                ? 'bg-white text-pitch-800 shadow-sm'
                : 'text-pitch-600 hover:text-pitch-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <DivisionFilter options={options} value={activeDivision} onChange={setDivisionId} />

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
        <div className="card p-6 text-center text-pitch-600">{emptyText}</div>
      )}

      {!loading &&
        !error &&
        shown.length > 0 &&
        visibleDivisions.map((d) => {
          const list = shown.filter((m) => m.competition.division.id === d.id);
          if (list.length === 0 && activeDivision === 'all') return null;
          return (
            <section key={d.id} className="space-y-2" aria-label={d.name}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display font-bold text-xl">{d.name}</h2>
                <p className="text-xs text-pitch-600">
                  {list.length} {list.length === 1 ? 'match' : 'matches'}
                </p>
              </div>
              {list.length === 0 ? (
                <div className="card p-4 text-sm text-pitch-600">
                  {tab === 'fixtures'
                    ? `No upcoming fixtures in ${d.name}.`
                    : `No results in ${d.name} yet.`}
                </div>
              ) : (
                <ul className="space-y-2">
                  {list.map((m) => (
                    <MatchRow key={m.id} m={m} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
    </div>
  );
}
