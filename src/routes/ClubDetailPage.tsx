import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Search, Shield, Users } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/auth';
import { PageHeader, ErrorNote, LoadingBlock } from '@/components/ui';
import PlayerAvatar from '@/components/PlayerAvatar';
import { usePlayerPhotoUrls } from '@/lib/photos';
import { fetchDisciplineTotals, type DisciplineTotals } from '@/lib/playerRecord';
import { calcAge, one } from '@/lib/util';

interface ClubInfo {
  id: string;
  name: string;
  founded: number | null;
  contact: string | null;
}

interface TeamInfo {
  id: string;
  name: string;
  division: string;
}

interface RosterPlayer {
  registrationId: string;
  teamId: string;
  status: 'active' | 'suspended';
  id: string;
  full_name: string;
  dob: string;
  gender: 'male' | 'female';
  photo_path: string | null;
}

export default function ClubDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const notMine = !isAdmin && profile?.club_id !== id;

  const [club, setClub] = useState<ClubInfo | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [totals, setTotals] = useState<Record<string, DisciplineTotals> | null>(null);
  const [banLeft, setBanLeft] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const photoUrls = usePlayerPhotoUrls(players);

  const load = useCallback(async () => {
    if (!id || notMine) {
      setLoading(false);
      return;
    }
    const [clubRes, teamRes] = await Promise.all([
      supabase.from('club').select('id, name, founded, contact').eq('id', id).maybeSingle(),
      supabase
        .from('team')
        .select('id, name, division:division_id(name)')
        .eq('club_id', id)
        .order('name'),
    ]);
    if (clubRes.error || teamRes.error) {
      setError('Could not load this club. Check your connection and try again.');
      setLoading(false);
      return;
    }
    if (!clubRes.data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setClub(clubRes.data as ClubInfo);
    const teamList: TeamInfo[] = ((teamRes.data ?? []) as unknown[]).map((raw) => {
      const t = raw as { id: string; name: string; division: { name: string } | { name: string }[] | null };
      return { id: t.id, name: t.name, division: one(t.division)?.name ?? 'No division' };
    });
    setTeams(teamList);

    if (teamList.length === 0) {
      setLoading(false);
      return;
    }

    const regRes = await supabase
      .from('registration')
      .select('id, team_id, status, player:player_id(id, full_name, dob, gender, photo_path)')
      .in('team_id', teamList.map((t) => t.id))
      .in('status', ['active', 'suspended']);
    if (regRes.error) {
      setError('Could not load the players. Check your connection and try again.');
      setLoading(false);
      return;
    }

    const roster: RosterPlayer[] = [];
    for (const raw of (regRes.data ?? []) as unknown[]) {
      const r = raw as {
        id: string;
        team_id: string;
        status: 'active' | 'suspended';
        player: Omit<RosterPlayer, 'registrationId' | 'teamId' | 'status'> | Omit<RosterPlayer, 'registrationId' | 'teamId' | 'status'>[] | null;
      };
      const p = one(r.player);
      if (!p) continue;
      roster.push({ ...p, registrationId: r.id, teamId: r.team_id, status: r.status });
    }
    roster.sort((a, b) => a.full_name.localeCompare(b.full_name));
    setPlayers(roster);
    setLoading(false);

    // Goal and card totals and current bans fill in after the list is already on screen.
    // If either fails the roster still works; the numbers are simply left out.
    const [t, sus] = await Promise.all([
      fetchDisciplineTotals([...new Set(roster.map((p) => p.id))]),
      supabase.rpc('my_suspensions'),
    ]);
    setTotals(t);
    if (!sus.error) {
      const left: Record<string, number> = {};
      for (const s of (sus.data ?? []) as { player_id: string; status: string; matches_remaining: number }[]) {
        if (s.status === 'active') left[s.player_id] = Math.max(left[s.player_id] ?? 0, s.matches_remaining);
      }
      setBanLeft(left);
    }
  }, [id, notMine]);

  useEffect(() => {
    load();
  }, [load]);

  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () => (query ? players.filter((p) => p.full_name.toLowerCase().includes(query)) : players),
    [players, query]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title={club?.name ?? 'Club'}
        intro={
          club
            ? `${club.founded ? `Founded ${club.founded}` : 'Founding year not set'}${club.contact ? ` · ${club.contact}` : ''}`
            : undefined
        }
        backTo="/admin/clubs"
        backLabel="Clubs & teams"
      />

      <ErrorNote message={error} />
      {loading && <LoadingBlock />}

      {!loading && notMine && (
        <div className="card p-6 text-center text-pitch-700">
          You can only view the players of your own club.
        </div>
      )}

      {!loading && notFound && (
        <div className="card p-6 text-center text-pitch-700">This club could not be found.</div>
      )}

      {!loading && club && (
        <>
          {players.length > 6 && (
            <label className="relative block">
              <span className="sr-only">Search players by name</span>
              <Search
                className="w-4 h-4 text-pitch-500 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden
              />
              <input
                className="input pl-9"
                type="search"
                placeholder="Search players by name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          )}

          {teams.length === 0 && (
            <div className="card p-6 text-center text-pitch-600">
              This club has no teams yet. Add a team on the Clubs &amp; teams page.
            </div>
          )}

          {teams.map((team) => {
            const teamPlayers = visible.filter((p) => p.teamId === team.id);
            const teamTotal = players.filter((p) => p.teamId === team.id).length;
            return (
              <section key={team.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-pitch-500 shrink-0" aria-hidden />
                  <h2 className="font-display font-bold text-lg">{team.name}</h2>
                  <span className="text-sm text-pitch-600">{team.division}</span>
                  <span className="badge bg-pitch-100 text-pitch-700 ml-auto">
                    {teamTotal} player{teamTotal === 1 ? '' : 's'}
                  </span>
                </div>

                {teamPlayers.length === 0 ? (
                  <div className="card p-4 text-pitch-600">
                    {query ? 'No players match your search.' : 'No players registered to this team yet.'}
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {teamPlayers.map((p) => {
                      const t = totals?.[p.id];
                      const left = banLeft[p.id];
                      return (
                        <li key={p.registrationId}>
                          <Link
                            to={`/players/${p.id}`}
                            state={{ from: `/clubs/${club.id}`, fromLabel: club.name }}
                            className="card p-3 flex items-center gap-3 hover:bg-pitch-50 transition-colors"
                          >
                            <PlayerAvatar name={p.full_name} url={photoUrls[p.id]} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold truncate">{p.full_name}</p>
                              <p className="text-sm text-pitch-600">
                                {p.gender === 'female' ? 'Female' : 'Male'} · {calcAge(p.dob)} yrs
                              </p>
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {left !== undefined && (
                                  <span className="badge text-xs bg-ember-500/10 text-ember-700">
                                    Suspended: {left} {left === 1 ? 'match' : 'matches'} left
                                  </span>
                                )}
                                {t && t.goals > 0 && (
                                  <span className="badge text-xs bg-pitch-100 text-pitch-700">
                                    {t.goals} {t.goals === 1 ? 'goal' : 'goals'}
                                  </span>
                                )}
                                {t && t.yellow > 0 && (
                                  <span className="badge text-xs bg-gold-400/30 text-gold-600">
                                    {t.yellow} yellow
                                  </span>
                                )}
                                {t && t.red > 0 && (
                                  <span className="badge text-xs bg-ember-500/10 text-ember-700">
                                    {t.red} red
                                  </span>
                                )}
                              </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-pitch-400 shrink-0" aria-hidden />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
