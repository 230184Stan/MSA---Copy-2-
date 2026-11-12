import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import type { StandingWithTeam } from '@/lib/types';
import { one } from '@/lib/util';
import { ArrowLeft, AlertCircle, Trophy } from 'lucide-react';
import DivisionFilter from '@/components/DivisionFilter';
import { compareDivisions, sortSeasons } from '@/lib/divisions';
import type { DivisionInfo, SeasonInfo } from '@/lib/divisions';

interface CompOption {
  id: string;
  name: string;
  season: SeasonInfo;
  division: DivisionInfo;
}

type Embedded<T> = T | T[] | null;
type TeamRef = { id: string; name: string; club_id: string };

function StandingsTable({ rows }: { rows: StandingWithTeam[] }) {
  if (rows.length === 0) {
    return (
      <div className="card p-6 text-center text-pitch-600">
        No teams have been entered in this division yet.
      </div>
    );
  }
  return (
    <div className="card overflow-hidden">
      {/* Desktop / wide table */}
      <table className="hidden sm:table w-full text-sm">
        <thead>
          <tr className="bg-pitch-50 text-pitch-700 text-left">
            <th className="py-3 px-3 font-semibold w-10 text-center">#</th>
            <th className="py-3 px-3 font-semibold">Team</th>
            <th className="py-3 px-2 font-semibold text-center w-10" title="Played">P</th>
            <th className="py-3 px-2 font-semibold text-center w-10" title="Won">W</th>
            <th className="py-3 px-2 font-semibold text-center w-10" title="Drawn">D</th>
            <th className="py-3 px-2 font-semibold text-center w-10" title="Lost">L</th>
            <th className="py-3 px-2 font-semibold text-center w-12" title="Goals For">GF</th>
            <th className="py-3 px-2 font-semibold text-center w-12" title="Goals Against">GA</th>
            <th className="py-3 px-2 font-semibold text-center w-12" title="Goal Difference">GD</th>
            <th className="py-3 px-3 font-semibold text-center w-12" title="Points">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.team_id}
              className="border-t border-pitch-100 hover:bg-pitch-50/50 transition-colors"
            >
              <td className="py-3 px-3 text-center font-semibold text-pitch-500">{i + 1}</td>
              <td className="py-3 px-3">
                <p className="font-semibold">{r.team.name}</p>
                {r.club.name && <p className="text-xs text-pitch-500">{r.club.name}</p>}
              </td>
              <td className="py-3 px-2 text-center tabular-nums">{r.played}</td>
              <td className="py-3 px-2 text-center tabular-nums">{r.wins}</td>
              <td className="py-3 px-2 text-center tabular-nums">{r.draws}</td>
              <td className="py-3 px-2 text-center tabular-nums">{r.losses}</td>
              <td className="py-3 px-2 text-center tabular-nums">{r.goals_for}</td>
              <td className="py-3 px-2 text-center tabular-nums">{r.goals_against}</td>
              <td className="py-3 px-2 text-center tabular-nums">
                {r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}
              </td>
              <td className="py-3 px-3 text-center font-display font-bold tabular-nums">
                {r.points}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile card list */}
      <ul className="sm:hidden divide-y divide-pitch-100">
        {rows.map((r, i) => (
          <li key={r.team_id} className="p-4">
            <div className="flex items-center gap-3">
              <span className="w-6 text-center font-bold text-pitch-500 shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate">{r.team.name}</p>
                {r.club.name && <p className="text-xs text-pitch-500 truncate">{r.club.name}</p>}
              </div>
              <span className="font-display font-extrabold text-xl tabular-nums">{r.points}</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1 text-center text-xs text-pitch-600">
              <div>
                <span className="font-semibold text-pitch-800">{r.played}</span>
                <br />
                Played
              </div>
              <div>
                <span className="font-semibold text-pitch-800">{r.wins}</span>
                <br />
                Won
              </div>
              <div>
                <span className="font-semibold text-pitch-800">{r.draws}</span>
                <br />
                Drawn
              </div>
              <div>
                <span className="font-semibold text-pitch-800">{r.losses}</span>
                <br />
                Lost
              </div>
            </div>
            <p className="mt-2 text-xs text-pitch-500">
              GF {r.goals_for} · GA {r.goals_against} · GD{' '}
              {r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StandingsPage() {
  const [comps, setComps] = useState<CompOption[]>([]);
  const [compsLoaded, setCompsLoaded] = useState(false);
  const [tables, setTables] = useState<Record<string, StandingWithTeam[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState('');
  const [divisionId, setDivisionId] = useState('all');

  // 1) Every competition, with its season and division.
  useEffect(() => {
    let cancelled = false;
    async function loadComps() {
      const { data, error: err } = await supabase
        .from('competition')
        .select(
          'id, name, season:season_id(id, name, is_current), division:division_id(id, name, level)'
        );
      if (cancelled) return;
      if (err) {
        setError('Could not load competitions. Check your connection and try again.');
        setLoading(false);
        return;
      }
      const list: CompOption[] = [];
      for (const r of (data ?? []) as unknown[]) {
        const row = r as {
          id: string;
          name: string;
          season: Embedded<SeasonInfo>;
          division: Embedded<DivisionInfo>;
        };
        const season = one(row.season);
        const division = one(row.division);
        if (season && division) list.push({ id: row.id, name: row.name, season, division });
      }
      setComps(list);
      setCompsLoaded(true);
    }
    loadComps();
    return () => {
      cancelled = true;
    };
  }, []);

  const seasons = useMemo(() => sortSeasons(comps.map((c) => c.season)), [comps]);
  const season = seasons.find((s) => s.id === seasonId) ?? seasons[0];
  const seasonComps = useMemo(
    () =>
      comps
        .filter((c) => c.season.id === season?.id)
        .sort((a, b) => compareDivisions(a.division, b.division)),
    [comps, season?.id]
  );
  const compKey = seasonComps.map((c) => c.id).join(',');

  // 2) The tables for every division in the chosen season, in one go.
  useEffect(() => {
    if (!compsLoaded) return;
    let cancelled = false;
    async function load() {
      const ids = compKey ? compKey.split(',') : [];
      if (ids.length === 0) {
        setTables({});
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);

      const [standingsRes, entriesRes] = await Promise.all([
        supabase
          .from('standings')
          .select(
            'competition_id, team_id, played, wins, draws, losses, goals_for, goals_against, goal_difference, points'
          )
          .in('competition_id', ids),
        supabase
          .from('competition_entry')
          .select('competition_id, team_id, team:team_id(id, name, club_id)')
          .in('competition_id', ids),
      ]);
      if (cancelled) return;
      if (standingsRes.error || entriesRes.error) {
        setError('Could not load the standings. Check your connection and try again.');
        setLoading(false);
        return;
      }

      const teamInfo = new Map<string, TeamRef>();
      const entered = new Map<string, string[]>(); // competition -> team ids
      for (const e of (entriesRes.data ?? []) as unknown[]) {
        const row = e as { competition_id: string; team_id: string; team: Embedded<TeamRef> };
        const t = one(row.team);
        if (t) teamInfo.set(t.id, t);
        entered.set(row.competition_id, [...(entered.get(row.competition_id) ?? []), row.team_id]);
      }

      const clubIds = [...new Set([...teamInfo.values()].map((t) => t.club_id))];
      const { data: clubs } = await supabase
        .from('club')
        .select('id, name')
        .in('id', clubIds.length ? clubIds : ['00000000-0000-0000-0000-000000000000']);
      if (cancelled) return;
      const clubName = new Map<string, string>();
      for (const c of clubs ?? []) clubName.set(c.id, c.name);

      const toRow = (
        competition_id: string,
        team_id: string,
        stats: Partial<StandingWithTeam>
      ): StandingWithTeam => {
        const t = teamInfo.get(team_id);
        return {
          competition_id,
          team_id,
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goals_for: 0,
          goals_against: 0,
          goal_difference: 0,
          points: 0,
          ...stats,
          team: { id: team_id, name: t?.name ?? 'Unknown', club_id: t?.club_id ?? '' },
          club: { id: t?.club_id ?? '', name: clubName.get(t?.club_id ?? '') ?? '' },
        };
      };

      const byComp: Record<string, StandingWithTeam[]> = {};
      for (const id of ids) byComp[id] = [];
      for (const s of (standingsRes.data ?? []) as StandingWithTeam[]) {
        byComp[s.competition_id]?.push(toRow(s.competition_id, s.team_id, s));
      }
      // Teams that are entered but have not played yet still get a row.
      for (const id of ids) {
        for (const teamId of entered.get(id) ?? []) {
          if (!byComp[id].some((r) => r.team_id === teamId)) byComp[id].push(toRow(id, teamId, {}));
        }
        byComp[id].sort(
          (a, b) =>
            b.points - a.points ||
            b.goal_difference - a.goal_difference ||
            b.goals_for - a.goals_for ||
            a.team.name.localeCompare(b.team.name)
        );
      }

      setTables(byComp);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [compsLoaded, compKey]);

  const options = seasonComps.map((c) => ({ id: c.division.id, name: c.division.name }));
  const activeDivision = seasonComps.some((c) => c.division.id === divisionId) ? divisionId : 'all';
  const visible =
    activeDivision === 'all' ? seasonComps : seasonComps.filter((c) => c.division.id === activeDivision);

  return (
    <div className="space-y-4">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-pitch-700 font-medium min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden /> Home
      </Link>

      <div className="flex items-center gap-2">
        <Trophy className="w-6 h-6 text-gold-500" aria-hidden />
        <h1 className="font-display font-bold text-2xl">Standings</h1>
      </div>
      <p className="text-pitch-700">
        A league table for each division
        {season ? `, ${season.name} season` : ''}, updated from completed matches.
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

      <DivisionFilter options={options} value={activeDivision} onChange={setDivisionId} />

      {loading && <div className="skeleton h-64 w-full" />}

      {error && (
        <div className="card p-4 border-ember-500 bg-ember-500/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-ember-600 mt-0.5 shrink-0" aria-hidden />
          <p className="text-sm text-ember-700">{error}</p>
        </div>
      )}

      {!loading && !error && seasonComps.length === 0 && (
        <div className="card p-6 text-center text-pitch-600">
          No standings available yet. Matches will appear here once results are recorded.
        </div>
      )}

      {!loading &&
        !error &&
        visible.map((c) => (
          <section key={c.id} className="space-y-2" aria-label={c.division.name}>
            <h2 className="font-display font-bold text-xl">{c.division.name}</h2>
            <StandingsTable rows={tables[c.id] ?? []} />
          </section>
        ))}
    </div>
  );
}
