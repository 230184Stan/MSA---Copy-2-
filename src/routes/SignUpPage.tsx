import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function SignUpPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    setSubmitting(false);
    if (error) {
      setError(
        error.message.includes('already')
          ? 'An account with that email already exists. Try signing in instead.'
          : 'Could not create your account. Please try again.'
      );
      return;
    }
    // Email confirmation is OFF, so a session should be returned immediately.
    if (data.session) {
      navigate('/dashboard');
    } else {
      // Fallback: if no session, go to sign-in.
      navigate('/signin');
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="font-display font-bold text-2xl mb-1">Create an account</h1>
      <p className="text-pitch-700 mb-6">
        New accounts start as a public viewer. An admin can upgrade your role to
        club manager or referee.
      </p>

      <form onSubmit={handleSubmit} className="card p-5 space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-semibold mb-1">
            Full name
          </label>
          <input
            id="name"
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border border-pitch-200 px-4 py-3 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-pitch-400"
            placeholder="John Smith"
          />
        </div>

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
            autoComplete="new-password"
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
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Creating account…
            </>
          ) : (
            'Create account'
          )}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-pitch-700">
        Already have an account?{' '}
        <Link to="/signin" className="font-semibold text-pitch-700 underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
