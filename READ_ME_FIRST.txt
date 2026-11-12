MSA division update
===================
STEP 0 (2 minutes, do this first): your project folder contains a text file named
  "pg_dump postgresqlpostgres....txt"
It holds your DATABASE PASSWORD in plain text and your .gitignore did not ignore it.
  1. Delete that file (and supabase-backup.sql if you do not need it).
  2. Supabase > Project Settings > Database > Reset database password. Use a NEW one.
  3. This package's .gitignore now ignores pg_dump* files.

STEP 1  Database. Supabase > SQL Editor > New query:
  a) paste ALL of supabase/ALL_IN_ONE_setup.sql and Run (safe to run again, keeps your data).
  b) paste ALL of supabase/sample-data/4_fix_division_mismatches.sql and Run.
     It moves the 5 Men's A matches that use Coastal United FC (a Men's B team) onto
     Coastal United A, and removes the duplicate entry. Players and scores are untouched.

STEP 2  Code. Copy the files in this folder over your project (say yes to replace), then:
  npm run dev     (restart it)

Housekeeping: supabase/migrations contains each of 003, 004, 005 and 006 TWICE (a ".sql" and a
".sql.sql" copy). Delete the four ".sql.sql" files so every migration exists once.
