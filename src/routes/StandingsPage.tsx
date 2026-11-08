import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import type { StandingWithTeam } from '@/lib/types';
import { one } from '@/lib/util';

interface CompOption {
  id: string;
  name: string;
  isCurrent: boolean;
  level: number;
}
import { ArrowLeft, AlertCircle, Trophy } from 'lucide-react';

export default function StandingsPage() {
  const [rows, setRows] = useState<StandingWithTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compName, setCompName] = useState<string>('');
  const [comps, setComps] = useState<CompOption[]>([]);
  const [compId, setCompId] = useState<string | null>(null);
  const [compsLoaded, setCompsLoaded] = useState(false);

  // 1) Load every competition once. Default to the current season's top division.
  useEffect(() => {
    let cancelled = false;
    async function loadComps() {
      const { data, error: err } = await supabase
        .from('competition')
        .select('id, name, season:season_id(is_current), division:division_id(level)');
      if (cancelled) return;
      if (err) {
        setError('Could not load competitions. Check your connection and try again.');
        setLoading(false);
        return;
      }
      const list: CompOption[] = ((data ?? []) as unknown[]).map((r) => {
        const row = r as {
          id: string;
          name: string;
          season: { is_current: boolean } | { is_current: boolean }[] | null;
          division: { level: number | null } | { level: number | null }[] | null;
        };
        return {
          id: row.id,
          name: row.name,
          isCurrent: !!one(row.season)?.is_current,
          level: one(row.division)?.level ?? 99,
        };
      });
      list.sort(
        (a, b) =>
          Number(b.isCurrent) - Number(a.isCurrent) ||
          a.level - b.level ||
          a.name.localeCompare(b.name)
      );
      setComps(list);
      setCompId(list[0]?.id ?? null);
      setCompsLoaded(true);
    }
    loadComps();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Load the table for the chosen competition.
  useEffect(() => {
    if (!compsLoaded) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);

      const comp = comps.find((c) => c.id === compId);
      if (!comp) {
        setRows([]);
        setLoading(false);
        return;
      }
      setCompName(comp.name);

      // Pull standings rows and team names in parallel
      const [standingsRes, entriesRes] = await Promise.all([
        supabase
          .from('standings')
          .select(
            'competition_id, team_id, played, wins, draws, losses, goals_for, goals_against, goal_difference, points'
          )
          .eq('competition_id', comp.id),
        supabase
          .from('competition_entry')
          .select('team_id, team:team_id(id, name, club_id)')
          .eq('competition_id', comp.id),
      ]);

      if (cancelled) return;

      // Build a lookup of team -> club name
      const teamMap = new Map<string, { name: string; club_id: string }>();
      for (const e of entriesRes.data ?? []) {
        type TeamRef = { id: string; name: string; club_id: string };
        const raw = (e as unknown as { team?: TeamRef | TeamRef[] | null }).team;
        const t = Array.isArray(raw) ? raw[0] : raw;
        if (t) teamMap.set(t.id, { name: t.name, club_id: t.club_id });
      }

      // Fetch club names for the teams in this competition
      const clubIds = [...new Set([...teamMap.values()].map((t) => t.club_id))];
      const { data: clubs } = await supabase
        .from('club')
        .select('id, name')
        .in('id', clubIds.length ? clubIds : ['00000000-0000-0000-0000-000000000000']);

      if (cancelled) return;
      const clubMap = new Map<string, string>();
      for (const c of clubs ?? []) clubMap.set(c.id, c.name);

      // Merge standings + team + club, sorted by points desc, then GD, then GF
      const merged: StandingWithTeam[] = (standingsRes.data ?? []).map((s) => {
        const team = teamMap.get((s as { team_id: string }).team_id);
        return {
          ...(s as Omit<StandingWithTeam, 'team' | 'club'>),
          team: {
            id: (s as { team_id: string }).team_id,
            name: team?.name ?? 'Unknown',
            club_id: team?.club_id ?? '',
          },
          club: {
            id: team?.club_id ?? '',
            name: clubMap.get(team?.club_id ?? '') ?? '',
          },
        };
      });

      // Also include teams with 0 played (entered but no completed matches)
      for (const [tid, tinfo] of teamMap) {
        if (!merged.find((r) => r.team_id === tid)) {
          merged.push({
            competition_id: comp.id,
            team_id: tid,
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goals_for: 0,
            goals_against: 0,
            goal_difference: 0,
            points: 0,
            team: { id: tid, name: tinfo.name, club_id: tinfo.club_id },
            club: { id: tinfo.club_id, name: clubMap.get(tinfo.club_id) ?? '' },
          });
        }
      }

      merged.sort(
        (a, b) =>
          b.points - a.points ||
          b.goal_difference - a.goal_difference ||
          b.goals_for - a.goals_for ||
          a.team.name.localeCompare(b.team.name)
      );

      setRows(merged);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [compsLoaded, compId, comps]);

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
      {comps.length > 1 && (
        <label className="block max-w-sm">
          <span className="text-sm font-medium text-pitch-800">Competition</span>
          <select
            className="input mt-1"
            value={compId ?? ''}
            onChange={(e) => setCompId(e.target.value)}
          >
            {comps.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {compName && (
        <p className="text-pitch-700">
          {compName} — league table updated from completed matches.
        </p>
      )}

      {loading && <div className="skeleton h-64 w-full" />}

      {error && (
        <div className="card p-4 border-ember-500 bg-ember-500/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-ember-600 mt-0.5 shrink-0" aria-hidden />
          <p className="text-sm text-ember-700">{error}</p>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="card p-6 text-center text-pitch-600">
          No standings available yet. Matches will appear here once results are recorded.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
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
                  <td className="py-3 px-3 text-center font-semibold text-pitch-500">
                    {i + 1}
                  </td>
                  <td className="py-3 px-3">
                    <p className="font-semibold">{r.team.name}</p>
                    {r.club.name && (
                      <p className="text-xs text-pitch-500">{r.club.name}</p>
                    )}
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
                  <span className="w-6 text-center font-bold text-pitch-500 shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{r.team.name}</p>
                    {r.club.name && (
                      <p className="text-xs text-pitch-500 truncate">{r.club.name}</p>
                    )}
                  </div>
                  <span className="font-display font-extrabold text-xl tabular-nums">
                    {r.points}
                  </span>
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
      )}
    </div>
  );
}
