import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy, Plus, Loader2, X, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { Season, Division, Competition, Team, Club } from '@/lib/types';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock, Field } from '@/components/ui';
import { errMsg, formatKickoff } from '@/lib/util';

interface Entry {
  id: string;
  competition_id: string;
  team_id: string;
}
interface MatchRow {
  id: string;
  competition_id: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_at: string;
  venue: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  published: boolean;
}

interface CardProps {
  comp: Competition;
  divisionName: string;
  seasonName: string;
  entries: Entry[];
  matches: MatchRow[];
  teams: Team[];
  teamLabel: (id: string) => string;
  onChanged: () => void;
}

function CompetitionCard({
  comp,
  divisionName,
  seasonName,
  entries,
  matches,
  teams,
  teamLabel,
  onChanged,
}: CardProps) {
  const [addTeamId, setAddTeamId] = useState('');
  const [mf, setMf] = useState({ home: '', away: '', kickoff: '', venue: '', published: true });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const entered = new Set(entries.map((e) => e.team_id));
  // Only offer teams that play in this competition's division and are not already entered.
  const candidates = teams.filter(
    (t) => t.division_id === comp.division_id && !entered.has(t.id)
  );

  async function addEntry() {
    setErr(null);
    if (!addTeamId) return setErr('Choose a team to add.');
    setBusy(true);
    const { error } = await supabase
      .from('competition_entry')
      .insert({ competition_id: comp.id, team_id: addTeamId });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setAddTeamId('');
    onChanged();
  }

  async function removeEntry(id: string) {
    if (!window.confirm('Remove this team from the competition?')) return;
    setErr(null);
    const { error } = await supabase.from('competition_entry').delete().eq('id', id);
    if (error) return setErr(errMsg(error));
    onChanged();
  }

  async function addMatch(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!mf.home || !mf.away) return setErr('Choose both the home and away teams.');
    if (mf.home === mf.away) return setErr('A team cannot play itself.');
    if (!mf.kickoff) return setErr('Choose the kick-off date and time.');
    setBusy(true);
    const { error } = await supabase.from('match').insert({
      competition_id: comp.id,
      home_team_id: mf.home,
      away_team_id: mf.away,
      kickoff_at: new Date(mf.kickoff).toISOString(),
      venue: mf.venue.trim() || null,
      status: 'scheduled',
      published: mf.published,
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setMf({ home: '', away: '', kickoff: '', venue: '', published: mf.published });
    onChanged();
  }

  async function removeMatch(id: string) {
    if (!window.confirm('Delete this match?')) return;
    setErr(null);
    const { error } = await supabase.from('match').delete().eq('id', id);
    if (error) return setErr(errMsg(error));
    onChanged();
  }

  const sorted = [...matches].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));

  return (
    <details className="card p-4 group">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2 min-h-[44px]">
        <div>
          <h3 className="font-semibold text-lg">{comp.name}</h3>
          <p className="text-sm text-pitch-600">
            {divisionName} · {seasonName} · {entries.length} teams · {matches.length} matches
          </p>
        </div>
        <span className="text-pitch-500 text-sm group-open:hidden">Open</span>
        <span className="text-pitch-500 text-sm hidden group-open:inline">Close</span>
      </summary>

      <div className="mt-4 space-y-5">
        <ErrorNote message={err} />

        <section>
          <h4 className="font-semibold text-sm text-pitch-800 mb-2">Teams in this competition</h4>
          {entries.length === 0 ? (
            <p className="text-sm text-pitch-600">No teams yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {entries.map((en) => (
                <li
                  key={en.id}
                  className="badge bg-pitch-100 text-pitch-800 gap-1 pr-1"
                >
                  {teamLabel(en.team_id)}
                  <button
                    onClick={() => removeEntry(en.id)}
                    className="p-1.5 rounded-full hover:bg-pitch-200"
                    aria-label={`Remove ${teamLabel(en.team_id)}`}
                  >
                    <X className="w-3.5 h-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <select
              className="input"
              value={addTeamId}
              onChange={(e) => setAddTeamId(e.target.value)}
              aria-label="Team to add"
            >
              <option value="">
                {candidates.length ? 'Add a team…' : `No more ${divisionName} teams to add`}
              </option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {teamLabel(t.id)}
                </option>
              ))}
            </select>
            <button className="btn-secondary" onClick={addEntry} disabled={busy || !addTeamId}>
              Add
            </button>
          </div>
        </section>

        <section>
          <h4 className="font-semibold text-sm text-pitch-800 mb-2">Add a match</h4>
          <form onSubmit={addMatch} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Home team">
                <select className="input" value={mf.home} onChange={(e) => setMf({ ...mf, home: e.target.value })}>
                  <option value="">Choose…</option>
                  {entries.map((en) => (
                    <option key={en.id} value={en.team_id}>
                      {teamLabel(en.team_id)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Away team">
                <select className="input" value={mf.away} onChange={(e) => setMf({ ...mf, away: e.target.value })}>
                  <option value="">Choose…</option>
                  {entries.map((en) => (
                    <option key={en.id} value={en.team_id}>
                      {teamLabel(en.team_id)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kick-off">
                <input
                  type="datetime-local"
                  className="input"
                  value={mf.kickoff}
                  onChange={(e) => setMf({ ...mf, kickoff: e.target.value })}
                />
              </Field>
              <Field label="Venue" hint="Optional">
                <input className="input" value={mf.venue} onChange={(e) => setMf({ ...mf, venue: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 min-h-[44px] text-sm">
              <input
                type="checkbox"
                className="w-5 h-5"
                checked={mf.published}
                onChange={(e) => setMf({ ...mf, published: e.target.checked })}
              />
              Show this match on the public site
            </label>
            <button className="btn-primary" disabled={busy || entries.length < 2}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
              Add match
            </button>
            {entries.length < 2 && (
              <p className="text-sm text-pitch-600">Add at least two teams first.</p>
            )}
          </form>
        </section>

        <section>
          <h4 className="font-semibold text-sm text-pitch-800 mb-2">Matches</h4>
          {sorted.length === 0 ? (
            <p className="text-sm text-pitch-600">No matches yet.</p>
          ) : (
            <ul className="divide-y divide-pitch-100">
              {sorted.map((m) => (
                <li key={m.id} className="py-2 flex items-center gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {teamLabel(m.home_team_id)}{' '}
                      {m.home_score !== null && m.away_score !== null
                        ? `${m.home_score} - ${m.away_score}`
                        : 'v'}{' '}
                      {teamLabel(m.away_team_id)}
                    </p>
                    <p className="text-pitch-600">
                      {formatKickoff(m.kickoff_at)}
                      {m.venue ? ` · ${m.venue}` : ''} · {m.status}
                      {m.published ? '' : ' · hidden'}
                    </p>
                  </div>
                  {m.status === 'scheduled' && (
                    <button
                      onClick={() => removeMatch(m.id)}
                      className="ml-auto p-2 min-h-[44px] min-w-[44px] text-ember-600 hover:bg-ember-500/10 rounded-lg shrink-0"
                      aria-label="Delete match"
                    >
                      <Trash2 className="w-4 h-4 mx-auto" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}

export default function CompetitionsPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [comps, setComps] = useState<Competition[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [form, setForm] = useState({ season_id: '', division_id: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, d, c, en, t, cl, m] = await Promise.all([
      supabase.from('season').select('*').order('start_date', { ascending: false }),
      supabase
        .from('division')
        .select('*')
        .order('level', { ascending: true, nullsFirst: false })
        .order('name'),
      supabase.from('competition').select('*').order('created_at', { ascending: false }),
      supabase.from('competition_entry').select('id, competition_id, team_id'),
      supabase.from('team').select('*').order('name'),
      supabase.from('club').select('*'),
      supabase
        .from('match')
        .select(
          'id, competition_id, home_team_id, away_team_id, kickoff_at, venue, status, home_score, away_score, published'
        ),
    ]);
    const failed = [s, d, c, en, t, cl, m].some((r) => r.error);
    if (failed) {
      setError('Could not load competitions. Check your connection and try again.');
    } else {
      const seasonList = (s.data ?? []) as Season[];
      setSeasons(seasonList);
      setDivisions((d.data ?? []) as Division[]);
      setComps((c.data ?? []) as Competition[]);
      setEntries((en.data ?? []) as Entry[]);
      setTeams((t.data ?? []) as Team[]);
      setClubs((cl.data ?? []) as Club[]);
      setMatches((m.data ?? []) as MatchRow[]);
      setForm((f) => ({
        ...f,
        season_id: f.season_id || seasonList.find((x) => x.is_current)?.id || seasonList[0]?.id || '',
      }));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clubName = useMemo(() => new Map(clubs.map((c) => [c.id, c.name])), [clubs]);
  const teamLabel = useCallback(
    (id: string) => {
      const t = teams.find((x) => x.id === id);
      if (!t) return 'Unknown team';
      const cn = clubName.get(t.club_id);
      return cn && cn !== t.name ? `${t.name} (${cn})` : t.name;
    },
    [teams, clubName]
  );

  async function addCompetition(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    const season = seasons.find((s) => s.id === form.season_id);
    const division = divisions.find((d) => d.id === form.division_id);
    if (!season || !division) return setError('Choose a season and a division.');
    setBusy(true);
    const { error: err } = await supabase.from('competition').insert({
      season_id: season.id,
      division_id: division.id,
      name: `${division.name} ${season.name}`,
    });
    setBusy(false);
    if (err) {
      return setError(
        err.code === '23505'
          ? `${division.name} already has a competition in the ${season.name} season.`
          : errMsg(err)
      );
    }
    setOk(`Competition "${division.name} ${season.name}" created. Open it to add teams and matches.`);
    setForm({ ...form, division_id: '' });
    load();
  }

  const orderedComps = [...comps].sort((a, b) => {
    const sa = seasons.find((s) => s.id === a.season_id);
    const sb = seasons.find((s) => s.id === b.season_id);
    if (!!sb?.is_current !== !!sa?.is_current) return sa?.is_current ? -1 : 1;
    const la = divisions.find((d) => d.id === a.division_id)?.level ?? 99;
    const lb = divisions.find((d) => d.id === b.division_id)?.level ?? 99;
    return la - lb || a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Trophy}
        title="Competitions & fixtures"
        intro="A competition is one division in one season. Add its teams, then schedule its matches."
      />
      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <form onSubmit={addCompetition} className="card p-4 space-y-3">
            <h2 className="font-display font-bold text-lg">New competition</h2>
            {seasons.length === 0 ? (
              <p className="text-pitch-700">Create a season first (Seasons &amp; windows).</p>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Season">
                    <select
                      className="input"
                      value={form.season_id}
                      onChange={(e) => setForm({ ...form, season_id: e.target.value })}
                    >
                      {seasons.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.is_current ? ' (current)' : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Division">
                    <select
                      className="input"
                      value={form.division_id}
                      onChange={(e) => setForm({ ...form, division_id: e.target.value })}
                    >
                      <option value="">Choose…</option>
                      {divisions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <button className="btn-primary" disabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
                  Create competition
                </button>
              </>
            )}
          </form>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg">Competitions ({orderedComps.length})</h2>
            {orderedComps.length === 0 && (
              <div className="card p-4 text-pitch-600">No competitions yet.</div>
            )}
            {orderedComps.map((c) => (
              <CompetitionCard
                key={c.id}
                comp={c}
                divisionName={divisions.find((d) => d.id === c.division_id)?.name ?? 'Division'}
                seasonName={seasons.find((s) => s.id === c.season_id)?.name ?? ''}
                entries={entries.filter((x) => x.competition_id === c.id)}
                matches={matches.filter((x) => x.competition_id === c.id)}
                teams={teams}
                teamLabel={teamLabel}
                onChanged={load}
              />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

