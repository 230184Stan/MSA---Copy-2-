import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/auth';
import type { Division, Season, Role } from '@/lib/types';
import {
  ArrowLeft,
  Users,
  UserPlus,
  AlertCircle,
  Trash2,
  Search,
  Loader2,
  X,
} from 'lucide-react';

interface PlayerRow {
  id: string;
  full_name: string;
  dob: string;
  gender: 'male' | 'female';
  created_at: string;
}

interface RegistrationRow {
  id: string;
  player_id: string;
  team_id: string;
  division_id: string;
  season_id: string;
  status: 'active' | 'ended' | 'suspended';
  team: { id: string; name: string };
}

interface TeamRow {
  id: string;
  name: string;
  club_id: string;
  division_id: string | null;
}

const genderLabels: Record<string, string> = {
  male: 'Male',
  female: 'Female',
};

function calcAge(dob: string): number {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function PlayersPage() {
  const { profile } = useAuth();
  const role: Role = profile?.role ?? 'public';
  const isAdmin = role === 'admin';
  const clubId = profile?.club_id ?? null;

  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [registrations, setRegistrations] = useState<Record<string, RegistrationRow[]>>({});
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Add-player modal state
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    full_name: '',
    dob: '',
    gender: 'male' as 'male' | 'female',
    team_id: '',
    division_id: '',
  });

  // Register-existing-player modal state
  const [regPlayer, setRegPlayer] = useState<PlayerRow | null>(null);
  const [regForm, setRegForm] = useState({ team_id: '', division_id: '' });
  const [regError, setRegError] = useState<string | null>(null);
  const [regSubmitting, setRegSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);

    // Teams: admin sees all, club_manager sees only their club's
    let teamQuery = supabase.from('team').select('id, name, club_id, division_id');
    if (!isAdmin && clubId) {
      teamQuery = teamQuery.eq('club_id', clubId);
    } else if (!isAdmin && !clubId) {
      setPlayers([]);
      setTeams([]);
      setLoading(false);
      return;
    }
    const { data: teamData, error: teamErr } = await teamQuery.order('name');
    if (teamErr) {
      setError('Could not load teams.');
      setLoading(false);
      return;
    }
    setTeams(teamData ?? []);

    // Divisions + current season in parallel
    const [divRes, seasonRes, playerRes] = await Promise.all([
      supabase
        .from('division')
        .select('*')
        .order('level', { ascending: true, nullsFirst: false })
        .order('name'),
      supabase.from('season').select('*').eq('is_current', true).maybeSingle(),
      supabase.from('player').select('id, full_name, dob, gender, created_at').order('full_name'),
    ]);

    if (divRes.error || seasonRes.error) {
      setError('Could not load reference data.');
      setLoading(false);
      return;
    }
    setDivisions(divRes.data ?? []);
    setSeason(seasonRes.data as Season | null);

    // Players: RLS scopes to own club. For admin, RLS returns all.
    // We need registrations to know which players belong to our teams.
    const playerData = playerRes.data ?? [];
    const playerIds = playerData.map((p) => p.id);

    // Fetch registrations for these players (RLS scopes to own club)
    let regData: RegistrationRow[] = [];
    if (playerIds.length > 0) {
      const { data: rd, error: regErr } = await supabase
        .from('registration')
        .select('id, player_id, team_id, division_id, season_id, status, team:team_id(id, name)')
        .in('player_id', playerIds)
        .eq('status', 'active');
      if (regErr) {
        setError('Could not load player registrations.');
        setLoading(false);
        return;
      }
      regData = (rd ?? []) as unknown as RegistrationRow[];
    }

    // Group registrations by player
    const regMap: Record<string, RegistrationRow[]> = {};
    for (const r of regData) {
      if (!regMap[r.player_id]) regMap[r.player_id] = [];
      regMap[r.player_id].push(r);
    }
    setRegistrations(regMap);
    setPlayers(playerData as PlayerRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter players by search
  const filtered = useMemo(() => {
    if (!search.trim()) return players;
    const q = search.toLowerCase();
    return players.filter((p) => p.full_name.toLowerCase().includes(q));
  }, [players, search]);

  // Teams available for the form (only current club's teams for club_manager)
  const formTeams = teams;

  // Auto-select division from the chosen team
  function onTeamChange(teamId: string) {
    const t = teams.find((t) => t.id === teamId);
    setForm((f) => ({ ...f, team_id: teamId, division_id: t?.division_id ?? f.division_id }));
  }

  async function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.full_name.trim()) {
      setFormError('Player name is required.');
      return;
    }
    if (!form.dob) {
      setFormError('Date of birth is required.');
      return;
    }
    if (!form.team_id) {
      setFormError('Select a team to register the player to.');
      return;
    }
    if (!season) {
      setFormError('No current season is set. Ask an admin to create one.');
      return;
    }

    const divisionId = form.division_id || teams.find((t) => t.id === form.team_id)?.division_id;
    if (!divisionId) {
      setFormError('The selected team has no division. Pick a division manually.');
      return;
    }

    setSubmitting(true);
    // Insert player + registration in sequence
    const { data: newPlayer, error: playerErr } = await supabase
      .from('player')
      .insert({ full_name: form.full_name.trim(), dob: form.dob, gender: form.gender })
      .select('id, full_name, dob, gender, created_at')
      .single();

    if (playerErr) {
      setFormError(playerErr.message || 'Could not create the player record.');
      setSubmitting(false);
      return;
    }

    const { error: regErr } = await supabase.from('registration').insert({
      player_id: (newPlayer as PlayerRow).id,
      team_id: form.team_id,
      division_id: divisionId,
      season_id: season.id,
      status: 'active',
    });

    if (regErr) {
      // Player was created but registration failed — still a usable state.
      setFormError(
        'Player created, but registration failed: ' + (regErr.message || 'unknown error')
      );
    } else {
      setShowForm(false);
      setForm({ full_name: '', dob: '', gender: 'male', team_id: '', division_id: '' });
    }
    setSubmitting(false);
    load();
  }

  async function handleRegisterExisting(e: React.FormEvent) {
    e.preventDefault();
    setRegError(null);
    if (!regPlayer || !regForm.team_id) {
      setRegError('Select a team.');
      return;
    }
    if (!season) {
      setRegError('No current season is set.');
      return;
    }
    const divisionId =
      regForm.division_id || teams.find((t) => t.id === regForm.team_id)?.division_id;
    if (!divisionId) {
      setRegError('Pick a division for this team.');
      return;
    }

    setRegSubmitting(true);
    const { error } = await supabase.from('registration').insert({
      player_id: regPlayer.id,
      team_id: regForm.team_id,
      division_id: divisionId,
      season_id: season.id,
      status: 'active',
    });

    if (error) {
      setRegError(error.message || 'Could not register the player.');
    } else {
      setRegPlayer(null);
      setRegForm({ team_id: '', division_id: '' });
    }
    setRegSubmitting(false);
    load();
  }

  async function handleEndRegistration(regId: string) {
    const { error } = await supabase
      .from('registration')
      .update({ status: 'ended', end_date: new Date().toISOString().slice(0, 10) })
      .eq('id', regId);
    if (error) {
      alert('Could not end registration: ' + error.message);
      return;
    }
    load();
  }

  const canManage = isAdmin || (role === 'club_manager' && clubId != null);

  return (
    <div className="space-y-4">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1 text-pitch-700 font-medium min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden /> Dashboard
      </Link>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-pitch-600" aria-hidden />
          <h1 className="font-display font-bold text-2xl">Players</h1>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary text-sm"
          >
            <UserPlus className="w-4 h-4" aria-hidden />
            Add player
          </button>
        )}
      </div>
      <p className="text-pitch-700">
        Register players to your club's teams for the {season?.name ?? 'current'} season.
        Each player needs a name, date of birth, and gender to determine division eligibility.
      </p>

      {!canManage && (
        <div className="card p-4 border-gold-500 bg-gold-400/10 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-gold-600 mt-0.5 shrink-0" aria-hidden />
          <p className="text-sm text-pitch-800">
            Only club managers and admins can register players. Your account needs to be
            assigned to a club first.
          </p>
        </div>
      )}

      {/* Search */}
      {canManage && players.length > 0 && (
        <div className="relative">
          <Search className="w-4 h-4 text-pitch-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search players by name…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-pitch-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-pitch-400"
          />
        </div>
      )}

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

      {!loading && !error && canManage && filtered.length === 0 && (
        <div className="card p-6 text-center text-pitch-600">
          {players.length === 0
            ? 'No players registered yet. Click "Add player" to get started.'
            : 'No players match your search.'}
        </div>
      )}

      {!loading && !error && canManage && filtered.length > 0 && (
        <ul className="space-y-2">
          {filtered.map((p) => {
            const regs = registrations[p.id] ?? [];
            return (
              <li key={p.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-lg">{p.full_name}</p>
                    <p className="text-sm text-pitch-600">
                      {genderLabels[p.gender]} · Born {formatDate(p.dob)} · {calcAge(p.dob)} yrs
                    </p>
                  </div>
                  {canManage && regs.length === 0 && (
                    <button
                      onClick={() => {
                        setRegPlayer(p);
                        setRegForm({ team_id: '', division_id: '' });
                        setRegError(null);
                      }}
                      className="text-sm font-semibold text-pitch-600 hover:text-pitch-800 shrink-0"
                    >
                      Register to team
                    </button>
                  )}
                </div>

                {regs.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {regs.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between gap-2 bg-pitch-50 rounded-lg px-3 py-2 text-sm"
                      >
                        <span>
                          <span className="font-semibold">{r.team.name}</span>
                          {divisions.find((d) => d.id === r.division_id) && (
                            <span className="text-pitch-600">
                              {' '}
                              · {divisions.find((d) => d.id === r.division_id)!.name}
                            </span>
                          )}
                          <span className="ml-2 badge bg-pitch-100 text-pitch-600 text-xs">
                            {r.status}
                          </span>
                        </span>
                        {canManage && r.status === 'active' && (
                          <button
                            onClick={() => handleEndRegistration(r.id)}
                            className="text-pitch-400 hover:text-ember-600 transition-colors"
                            aria-label="End registration"
                            title="End registration"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canManage && regs.length > 0 && (
                  <button
                    onClick={() => {
                      setRegPlayer(p);
                      setRegForm({ team_id: '', division_id: '' });
                      setRegError(null);
                    }}
                    className="mt-2 text-xs font-semibold text-pitch-600 hover:text-pitch-800"
                  >
                    + Register to another team
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Add Player Modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !submitting && setShowForm(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-xl">Add player</h2>
              <button
                onClick={() => !submitting && setShowForm(false)}
                className="text-pitch-400 hover:text-pitch-600"
                aria-label="Close"
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>

            <form onSubmit={handleAddPlayer} className="space-y-3">
              <Field label="Full name" required>
                <input
                  type="text"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="input"
                  placeholder="e.g. John Wartovo"
                  required
                />
              </Field>

              <Field label="Date of birth" required>
                <input
                  type="date"
                  value={form.dob}
                  onChange={(e) => setForm({ ...form, dob: e.target.value })}
                  className="input"
                  max={new Date().toISOString().slice(0, 10)}
                  required
                />
              </Field>

              <Field label="Gender" required>
                <select
                  value={form.gender}
                  onChange={(e) =>
                    setForm({ ...form, gender: e.target.value as 'male' | 'female' })
                  }
                  className="input"
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </Field>

              <Field label="Team" required>
                {formTeams.length === 0 ? (
                  <p className="text-sm text-ember-600">
                    Your club has no teams yet. Ask an admin to create a team first.
                  </p>
                ) : (
                  <select
                    value={form.team_id}
                    onChange={(e) => onTeamChange(e.target.value)}
                    className="input"
                    required
                  >
                    <option value="">Select a team…</option>
                    {formTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field label="Division" required>
                <select
                  value={form.division_id}
                  onChange={(e) => setForm({ ...form, division_id: e.target.value })}
                  className="input"
                  required
                >
                  <option value="">Select a division…</option>
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.gender_rule === 'female'
                        ? ' (Women)'
                        : d.gender_rule === 'male'
                          ? ' (Men)'
                          : ' (Open)'}
                      {d.max_age != null ? ` · U${d.max_age + 1}` : ''}
                    </option>
                  ))}
                </select>
              </Field>

              {formError && (
                <p className="text-sm text-ember-600 bg-ember-500/5 rounded-lg p-2">
                  {formError}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="btn-secondary flex-1"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Saving…
                    </>
                  ) : (
                    'Save player'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register Existing Player Modal */}
      {regPlayer && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !regSubmitting && setRegPlayer(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display font-bold text-xl">Register player</h2>
                <p className="text-sm text-pitch-600">{regPlayer.full_name}</p>
              </div>
              <button
                onClick={() => !regSubmitting && setRegPlayer(null)}
                className="text-pitch-400 hover:text-pitch-600"
                aria-label="Close"
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>

            <form onSubmit={handleRegisterExisting} className="space-y-3">
              <Field label="Team" required>
                <select
                  value={regForm.team_id}
                  onChange={(e) => {
                    const t = teams.find((t) => t.id === e.target.value);
                    setRegForm({
                      team_id: e.target.value,
                      division_id: t?.division_id ?? '',
                    });
                  }}
                  className="input"
                  required
                >
                  <option value="">Select a team…</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Division" required>
                <select
                  value={regForm.division_id}
                  onChange={(e) => setRegForm({ ...regForm, division_id: e.target.value })}
                  className="input"
                  required
                >
                  <option value="">Select a division…</option>
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.gender_rule === 'female'
                        ? ' (Women)'
                        : d.gender_rule === 'male'
                          ? ' (Men)'
                          : ' (Open)'}
                      {d.max_age != null ? ` · U${d.max_age + 1}` : ''}
                    </option>
                  ))}
                </select>
              </Field>

              {regError && (
                <p className="text-sm text-ember-600 bg-ember-500/5 rounded-lg p-2">
                  {regError}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRegPlayer(null)}
                  className="btn-secondary flex-1"
                  disabled={regSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1" disabled={regSubmitting}>
                  {regSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Saving…
                    </>
                  ) : (
                    'Register'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-pitch-800">
        {label}
        {required && <span className="text-ember-500"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
