# Madang Soccer Association (MSA)

Web app for the Madang Soccer Association in Papua New Guinea.

**Mobile-first.** Works on cheap Android phones with slow or unreliable data.  
Roles: **admin**, **club manager**, **referee**, and the **public**.

---

## What it does

- Public fixtures, results, and standings (read-only, no login)
- Club managers register players, request division moves, view discipline
- Referees enter match results and events (goals, cards)
- Admins manage seasons, transfer windows, competitions, clubs, teams, and users
- Season rollover with “Ageing out” list for Under 18 players
- One active registration per player (enforced in the database)
- Eligibility checks (gender + age cut-off stored on the season)
- Teams can only be entered in, and play matches in, their own division (enforced in the database)
- Fixtures and standings are shown separately for each division, with a division filter
- Division moves run in a single database transaction

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Front end | React + Vite + TypeScript + Tailwind CSS + React Router |
| Backend | Supabase (PostgreSQL, Auth, Row Level Security) |
| Hosting | Vercel / Netlify / Cloudflare Pages (from GitHub) |
| Secrets | `.env` (never committed) |

---

## Quick start (new machine)

### 1. Database (do this first)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**.
3. Paste the entire contents of `supabase/ALL_IN_ONE_setup.sql` and click **Run**.  
   It is safe to run more than once.
4. (Optional) Run the sample-data scripts in `supabase/sample-data/` in order:
   - `1_coastal_united_mens_b_justice_league.sql`
   - `2_madang_rangers_mens_b_avengers.sql`
   - `3_mens_b_competition_and_fixtures.sql`
   - `4_mens_b_match_results_goals_and_cards.sql` (goals, cards and suspensions for the completed games)
   - `4_fix_division_mismatches.sql` — run this if any fixture or table shows a team from the
     wrong division. It swaps in the same club's team from the right division, leaves players and
     results alone, and tells you about anything it could not fix. Safe to run more than once.

### 2. Front-end setup

```bash
# Copy the project folder, then:
cp .env.example .env
```

Edit `.env` and set:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

(Find both values in Supabase → Project Settings → API.)

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually http://localhost:5173).

### 3. Make yourself admin

In the Supabase SQL Editor, run (replace the email):

```sql
insert into profiles (id, full_name, role)
select id, coalesce(raw_user_meta_data->>'full_name', 'Administrator'), 'admin'
from auth.users
where email = 'YOUR-EMAIL@example.com'
on conflict (id) do update set role = 'admin';
```

Sign up / sign in with that email, then refresh the app.

---

## Before a season starts (admin checklist)

1. **Seasons** — create the season, set the age cut-off date, mark it current.
2. **Transfer windows** — add two windows for the season.
3. **Discipline** — confirm card rules match association rules.
4. **Users** — give referees the `referee` role; assign them to matches later.
5. **Competitions** — create competitions and enter the teams for each division.

---

## End-of-season rollover (admin)

1. Create the **new** season (with its cut-off date and transfer windows).
2. Create the new season’s competitions and enter teams (not copied automatically).
3. Open **Season rollover** → check the preview (club managers also see their own ageing-out players).
4. Run the rollover **once**, then “Make the new season the current season”.
5. Club managers propose moves up for placed players on **Division moves** (inside a window).

---

## Database backup (download)

### Windows (Command Prompt)

1. Install PostgreSQL client tools so `pg_dump` is on your PATH.
2. Open a **new** Command Prompt and run **one single line**:

```cmd
pg_dump "postgresql://postgres.PROJECT-REF:YOUR-PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres" --clean --if-exists --no-owner --no-privileges -f supabase-backup.sql
```

Get the connection string from Supabase → **Connect** → **Session pooler**.

### Mac / Linux

```bash
pg_dump "YOUR-SESSION-POOLER-URI" \
  --clean --if-exists --no-owner --no-privileges \
  -f supabase-backup.sql
```

**Never commit** `supabase-backup.sql` or any file containing passwords.  
Do not save the connection string in a note inside the project folder; keep it in a password manager.  
Rotate the database password if it was ever shared (Supabase → Project Settings → Database → Reset database password).

---

## Project layout

```
msa-png/
├── src/
│   ├── components/     # Layout, protected routes, UI helpers
│   ├── lib/            # Supabase client, auth, eligibility, types
│   ├── routes/         # Pages (public + role-protected)
│   ├── App.tsx
│   └── main.tsx
├── supabase/
│   ├── ALL_IN_ONE_setup.sql   # Run this in Supabase SQL Editor
│   ├── migrations/            # Numbered migrations (001–014)
│   └── sample-data/           # Optional demo clubs & fixtures
├── .env.example
├── package.json
└── README.md
```

---

## Known gaps (not yet built)

- PWA install + offline result entry with sync (Phase 10)
- Announcements / notifications (Phase 11)
- GitHub Actions CI + production deployment polish (Phase 12)
- Match-day squad list (suspended players are blocked from moves but not from a formal squad)
- Hard block “player named in a match that day”
- Optional “one move per season” limit

---

## Free-tier notes

- Supabase free projects **pause after about a week of inactivity**. Open the dashboard and click “Restore” if the app stops connecting.
- Keep a local `supabase-backup.sql` so you can rebuild quickly if needed.
- Vercel / Netlify / Cloudflare Pages free tiers are fine for this app size.

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local development server |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

---

## Licence

Private use for the Madang Soccer Association. Not licensed for redistribution.
