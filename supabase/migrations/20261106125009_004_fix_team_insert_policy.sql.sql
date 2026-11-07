/*
# Fix team INSERT policy

The team insert policy incorrectly called club_of_team(club_id), which treats the
club_id column value as a team id. The correct check is a direct comparison:
club_id = my_club_id(). This matches the UPDATE policy already in place.

1. Security change
   - Drop and recreate the "team_insert_own_club_or_admin" policy with the
     correct predicate.
*/

drop policy if exists "team_insert_own_club_or_admin" on team;
create policy "team_insert_own_club_or_admin" on team
  for insert to authenticated
  with check (public.is_admin() or club_id = public.my_club_id());
