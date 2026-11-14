/*
# 016 — Player position

Adds an optional playing position to each player: goalkeeper, defender, midfielder or forward.
Optional, so every existing player keeps working and simply shows no position until one is set.

Who can set it follows the existing player rules: an administrator, or the manager of the
player's club (the player UPDATE policy already allows exactly that, so nothing else changes).

Safe to run more than once.
*/

alter table public.player
  add column if not exists playing_position text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'player_playing_position_check'
  ) then
    alter table public.player
      add constraint player_playing_position_check
      check (playing_position is null
             or playing_position in ('goalkeeper','defender','midfielder','forward'));
  end if;
end $$;
