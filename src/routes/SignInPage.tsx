import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setError(
        error.message.includes('Invalid login')
          ? 'Wrong email or password. Please try again.'
          : 'Could not sign in. Check your connection and try again.'
      );
      return;
    }
    navigate('/dashboard');
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="font-display font-bold text-2xl mb-1">Sign in</h1>
      <p className="text-pitch-700 mb-6">
        Club managers, referees, and admins sign in here.
      </p>

      <form onSubmit={handleSubmit} className="card p-5 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-semibold mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-pitch-200 px-4 py-3 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-pitch-400"
            placeholder="you@example.org"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-semibold mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-pitch-200 px-4 py-3 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-pitch-400"
            placeholder="At least 6 characters"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-ember-700 bg-ember-500/5 border border-ember-500 rounded-xl p-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-pitch-700">
        No account?{' '}
        <Link to="/signup" className="font-semibold text-pitch-700 underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
