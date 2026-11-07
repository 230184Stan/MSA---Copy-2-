import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import type { Division } from '@/lib/types';
import { Trophy, Users, Calendar, ChevronRight, AlertCircle } from 'lucide-react';

export default function PublicHome() {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('division')
        .select('*')
        .order('level', { ascending: true, nullsFirst: false })
        .order('name');
      if (cancelled) return;
      if (error) {
        setError('Could not load divisions. Check your connection and try again.');
      } else {
        setDivisions(data ?? []);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="rounded-2xl bg-gradient-to-br from-pitch-600 to-pitch-800 text-white p-6 sm:p-8 shadow-md">
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl leading-tight">
          Madang Soccer Association
        </h1>
        <p className="mt-2 text-pitch-100 max-w-2xl">
          Fixtures, results, and league standings for clubs across Madang.
          Built to work on slow mobile data.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/divisions" className="btn-primary bg-gold-500 text-pitch-900 hover:bg-gold-400">
            View divisions
          </Link>
        </div>
      </section>

      {/* Quick links */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link
          to="/fixtures"
          className="card p-4 flex items-center gap-3 hover:border-pitch-300 transition-colors min-h-[64px]"
        >
          <Calendar className="w-7 h-7 text-pitch-600" aria-hidden />
          <span className="font-semibold">Fixtures</span>
          <ChevronRight className="w-5 h-5 ml-auto text-pitch-400" aria-hidden />
        </Link>
        <Link
          to="/standings"
          className="card p-4 flex items-center gap-3 hover:border-pitch-300 transition-colors min-h-[64px]"
        >
          <Trophy className="w-7 h-7 text-pitch-600" aria-hidden />
          <span className="font-semibold">Standings</span>
          <ChevronRight className="w-5 h-5 ml-auto text-pitch-400" aria-hidden />
        </Link>
        <Link
          to="/divisions"
          className="card p-4 flex items-center gap-3 hover:border-pitch-300 transition-colors min-h-[64px]"
        >
          <Users className="w-7 h-7 text-pitch-600" aria-hidden />
          <span className="font-semibold">Divisions</span>
          <ChevronRight className="w-5 h-5 ml-auto text-pitch-400" aria-hidden />
        </Link>
      </section>

      {/* Divisions preview */}
      <section>
        <h2 className="font-display font-bold text-xl mb-3">Divisions</h2>

        {loading && (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton h-16 w-full" />
            ))}
          </div>
        )}

        {error && (
          <div className="card p-4 border-ember-500 bg-ember-500/5 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-ember-600 mt-0.5 shrink-0" aria-hidden />
            <p className="text-sm text-ember-700">{error}</p>
          </div>
        )}

        {!loading && !error && divisions.length === 0 && (
          <div className="card p-6 text-center text-pitch-600">
            No divisions found. Seed data may not have loaded.
          </div>
        )}

        {!loading && !error && divisions.length > 0 && (
          <ul className="space-y-2">
            {divisions.map((d) => (
              <li key={d.id} className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-pitch-100 text-pitch-700 flex items-center justify-center font-bold shrink-0">
                  {d.level ?? 'U'}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{d.name}</p>
                  <p className="text-sm text-pitch-600">
                    {d.gender_rule === 'female'
                      ? 'Women'
                      : d.gender_rule === 'male'
                        ? 'Men'
                        : 'Open'}{' '}
                    {d.max_age != null && `· Under ${d.max_age + 1}`}
                    {d.level != null && ` · Tier ${d.level}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
