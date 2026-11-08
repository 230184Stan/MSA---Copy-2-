import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * False when .env is missing or wrong. App.tsx shows a friendly "setup needed"
 * screen instead of a blank page. A harmless placeholder client is created so
 * importing this file never crashes.
 */
export const isSupabaseConfigured = Boolean(url && anonKey && /^https?:\/\//.test(url));

export const supabase = createClient(
  isSupabaseConfigured ? (url as string) : 'http://localhost:54321',
  isSupabaseConfigured ? (anonKey as string) : 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: isSupabaseConfigured } }
);
