import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import type { Division } from '@/lib/types';
import { ArrowLeft, AlertCircle } from 'lucide-react';

export default function DivisionsPage() {
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
    <div className="space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-pitch-700 font-medium min-h-[44px]">
        <ArrowLeft className="w-4 h-4" aria-hidden /> Home
      </Link>

      <h1 className="font-display font-bold text-2xl">Divisions</h1>
      <p className="text-pitch-700">
        Five competitions across men's, women's, and youth football.
      </p>

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-20 w-full" />
          ))}
        </div>
      )}

      {error && (
        <div className="card p-4 border-ember-500 bg-ember-500/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-ember-600 mt-0.5 shrink-0" aria-hidden />
          <p className="text-sm text-ember-700">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {divisions.map((d) => (
            <li key={d.id} className="card p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-pitch-600 text-white flex items-center justify-center font-bold shrink-0">
                  {d.level ?? 'U'}
                </div>
                <div>
                  <p className="font-display font-bold text-lg">{d.name}</p>
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
