/*
# 015 — Delete a player profile (administrators only)

delete_player(player_id) removes the player together with everything that only exists
because of them: their registrations, suspensions, division-move requests and season
rollover rows (the database cascades these).

It REFUSES to delete a player who has goals or cards recorded in a match. Deleting them
would leave those matches with goals nobody scored, and would erase suspension history
that other results depend on. The error says so, so the administrator knows why.

It returns the player's photo path so the app can remove the photo file. The photo storage
policy is widened so an administrator can remove a photo file even after the player row is
gone (the old rule needed the player row to still exist).

Safe to run more than once.
*/

create or replace function public.delete_player(p_player_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text;
  v_photo  text;
  v_events integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can delete a player.';
  end if;

  select full_name, photo_path into v_name, v_photo
    from public.player where id = p_player_id;
  if not found then
    raise exception 'That player no longer exists.';
  end if;

  select count(*) into v_events
    from public.match_event e
    join public.registration r on r.id = e.registration_id
   where r.player_id = p_player_id;

  if v_events > 0 then
    raise exception '% has % goal, card or substitution record(s) in matches, so the profile cannot be deleted without changing past results.',
      v_name, v_events;
  end if;

  delete from public.player where id = p_player_id;
  return v_photo;
end;
$$;

revoke all on function public.delete_player(uuid) from public, anon;
grant execute on function public.delete_player(uuid) to authenticated;

-- Let an administrator remove a player's photo file whether or not the player row still exists.
drop policy if exists player_photos_delete on storage.objects;
create policy player_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'player-photos'
    and (
      public.my_role() = 'admin'
      or (
        public.my_role() = 'club_manager'
        and exists (select 1 from public.player p
                     where p.id::text = (storage.foldername(objects.name))[1])
      )
    )
  );
