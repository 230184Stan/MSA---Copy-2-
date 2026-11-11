MSA update package
==================
See README.md for full setup instructions.

QUICK DATABASE FIX (if you already have a working project):
  In Supabase > SQL Editor, paste and Run the file:
  supabase/FIX_standings_published.sql
  (or the same SQL from migrations/20261110100000_013_fix_standings_published.sql)

FULL SETUP (new project):
  1. Run supabase/ALL_IN_ONE_setup.sql in the SQL Editor (safe to re-run).
  2. Copy .env.example to .env and fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.
  3. npm install && npm run dev
  4. Make yourself admin (SQL in README.md).

Optional sample data: supabase/sample-data/ (run in order 1 → 2 → 3).
