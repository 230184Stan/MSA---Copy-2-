import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, Loader2, Shield, Users } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/auth';
import type { Club, Team, Division } from '@/lib/types';
import { PageHeader, ErrorNote, SuccessNote, LoadingBlock, Field } from '@/components/ui';
import { errMsg } from '@/lib/util';

export default function ClubsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const myClubId = profile?.club_id ?? null;

  const [clubs, setClubs] = useState<Club[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [clubForm, setClubForm] = useState({ name: '', founded: '', contact: '' });
  const [teamForm, setTeamForm] = useState({ club_id: '', name: '', division_id: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, t, d] = await Promise.all([
      supabase.from('club').select('*').order('name'),
      supabase.from('team').select('*').order('name'),
      supabase
        .from('division')
        .select('*')
        .order('level', { ascending: true, nullsFirst: false })
        .order('name'),
    ]);
    if (c.error || t.error || d.error) {
      setError('Could not load clubs. Check your connection and try again.');
    } else {
      setClubs((c.data ?? []) as Club[]);
      setTeams((t.data ?? []) as Team[]);
      setDivisions((d.data ?? []) as Division[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visibleClubs = isAdmin ? clubs : clubs.filter((c) => c.id === myClubId);
  const divName = (id: string | null) => divisions.find((d) => d.id === id)?.name ?? 'No division';

  async function addClub(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!clubForm.name.trim()) return setError('Club name is required.');
    const founded = clubForm.founded ? Number(clubForm.founded) : null;
    if (founded !== null && (!Number.isInteger(founded) || founded < 1850 || founded > 2100)) {
      return setError('Enter a valid year for "Founded", or leave it blank.');
    }
    setBusy(true);
    const { error: err } = await supabase.from('club').insert({
      name: clubForm.name.trim(),
      founded,
      contact: clubForm.contact.trim() || null,
    });
    setBusy(false);
    if (err) return setError(errMsg(err));
    setOk(`Club "${clubForm.name.trim()}" added.`);
    setClubForm({ name: '', founded: '', contact: '' });
    load();
  }

  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    const clubId = isAdmin ? teamForm.club_id : myClubId;
    if (!clubId) return setError('Choose a club.');
    if (!teamForm.name.trim()) return setError('Team name is required.');
    if (!teamForm.division_id) return setError('Choose the division this team plays in.');
    setBusy(true);
    const { error: err } = await supabase.from('team').insert({
      club_id: clubId,
      name: teamForm.name.trim(),
      division_id: teamForm.division_id,
    });
    setBusy(false);
    if (err) return setError(errMsg(err));
    setOk(`Team "${teamForm.name.trim()}" added.`);
    setTeamForm({ club_id: teamForm.club_id, name: '', division_id: '' });
    load();
  }

  if (!isAdmin && !myClubId && !loading) {
    return (
      <div className="space-y-4">
        <PageHeader icon={Building2} title="Clubs & teams" />
        <div className="card p-4 text-pitch-800">
          Your account is not linked to a club yet. Ask an administrator to link you to your club.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
        title="Clubs & teams"
        intro={
          isAdmin
            ? 'Add clubs, then add each team a club fields (for example a Men\'s A team and a Women\'s team).'
            : 'Add teams for your club. Each team plays in one division.'
        }
      />
      <ErrorNote message={error} />
      <SuccessNote message={ok} />

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          {isAdmin && (
            <form onSubmit={addClub} className="card p-4 space-y-3">
              <h2 className="font-display font-bold text-lg">New club</h2>
              <Field label="Club name">
                <input
                  className="input"
                  value={clubForm.name}
                  onChange={(e) => setClubForm({ ...clubForm, name: e.target.value })}
                  placeholder="e.g. Madang Rangers"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Founded (year)" hint="Optional">
                  <input
                    className="input"
                    inputMode="numeric"
                    value={clubForm.founded}
                    onChange={(e) => setClubForm({ ...clubForm, founded: e.target.value })}
                    placeholder="1998"
                  />
                </Field>
                <Field label="Contact" hint="Optional email or phone">
                  <input
                    className="input"
                    value={clubForm.contact}
                    onChange={(e) => setClubForm({ ...clubForm, contact: e.target.value })}
                  />
                </Field>
              </div>
              <button className="btn-primary" disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
                Add club
              </button>
            </form>
          )}

          <form onSubmit={addTeam} className="card p-4 space-y-3">
            <h2 className="font-display font-bold text-lg">New team</h2>
            {isAdmin && (
              <Field label="Club">
                <select
                  className="input"
                  value={teamForm.club_id}
                  onChange={(e) => setTeamForm({ ...teamForm, club_id: e.target.value })}
                >
                  <option value="">Choose a club…</option>
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Team name" hint="Must be unique within the club">
                <input
                  className="input"
                  value={teamForm.name}
                  onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                  placeholder="e.g. Rangers FC"
                />
              </Field>
              <Field label="Division">
                <select
                  className="input"
                  value={teamForm.division_id}
                  onChange={(e) => setTeamForm({ ...teamForm, division_id: e.target.value })}
                >
                  <option value="">Choose a division…</option>
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
              Add team
            </button>
          </form>

          <section className="space-y-3">
            <h2 className="font-display font-bold text-lg">
              {isAdmin ? 'All clubs' : 'Your club'} ({visibleClubs.length})
            </h2>
            {visibleClubs.length === 0 && (
              <div className="card p-4 text-pitch-600">No clubs yet.</div>
            )}
            {visibleClubs.map((club) => {
              const clubTeams = teams.filter((t) => t.club_id === club.id);
              return (
                <article key={club.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-lg">
                        <Link to={`/clubs/${club.id}`} className="hover:text-pitch-600 hover:underline">
                          {club.name}
                        </Link>
                      </h3>
                      <p className="text-sm text-pitch-600">
                        {club.founded ? `Founded ${club.founded}` : 'Founding year not set'}
                        {club.contact ? ` · ${club.contact}` : ''}
                      </p>
                    </div>
                    <span className="badge bg-pitch-100 text-pitch-700 shrink-0 whitespace-nowrap">
                      {clubTeams.length} team{clubTeams.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <Link
                    to={`/clubs/${club.id}`}
                    className="mt-3 inline-flex items-center gap-1 text-pitch-700 font-medium min-h-[44px] hover:underline"
                  >
                    <Users className="w-4 h-4" aria-hidden /> View players &amp; records
                  </Link>
                  {clubTeams.length > 0 && (
                    <ul className="mt-1 divide-y divide-pitch-100">
                      {clubTeams.map((t) => (
                        <li key={t.id} className="py-2 flex items-center gap-2">
                          <Shield className="w-4 h-4 text-pitch-500 shrink-0" aria-hidden />
                          <span className="font-medium min-w-0 break-words">{t.name}</span>
                          <span className="ml-auto text-sm text-pitch-600 shrink-0 whitespace-nowrap pl-2">{divName(t.division_id)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
