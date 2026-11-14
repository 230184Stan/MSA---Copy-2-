-- Gives every player who has a team a playing position, so each squad has a sensible spread.
-- Run AFTER migration 016 (player positions). Paste into Supabase > SQL Editor > New query > Run.
--
-- For each team, taking the players who have no position yet:
--   * 1 goalkeeper (2 if the squad has 14 or more players), skipped if the team already has one set
--   * of the rest: about 40% defenders, 35% midfielders, and the remainder forwards
-- Which player gets which position is a fixed shuffle, so running it again gives the same result.
--
-- It never changes a position that is already set, unless you change v_overwrite to true below.
-- Players who are not registered to any team are left alone (they have no team to play for).
-- You can change anyone afterwards on their profile page.
do $$
declare
  v_overwrite boolean := false;   -- true = redo EVERY player, including ones you already set
  v_changed   integer;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'player' and column_name = 'playing_position') then
    raise exception 'The player position column does not exist yet. Run migration 016 (20261114120000_016_player_position.sql) first.';
  end if;

  if v_overwrite then
    update public.player p set playing_position = null
     where exists (select 1 from public.registration r
                    where r.player_id = p.id and r.status in ('active', 'suspended'));
  end if;

  with squad as (
    -- each player's current team (their most recent active or suspended registration)
    select distinct on (p.id) p.id as player_id, r.team_id, p.playing_position as pos
      from public.player p
      join public.registration r on r.player_id = p.id and r.status in ('active', 'suspended')
     order by p.id, r.start_date desc, r.created_at desc
  ),
  team_info as (
    select team_id,
           count(*) filter (where pos = 'goalkeeper') as keepers_set
      from squad
     group by team_id
  ),
  todo as (
    select s.player_id, s.team_id,
           row_number() over (partition by s.team_id order by md5(s.player_id::text)) as rn,
           count(*)     over (partition by s.team_id)                                 as n
      from squad s
     where s.pos is null
  ),
  sized as (
    select t.*,
           -- goalkeepers still needed in this team
           least(t.n, greatest(0, (case when t.n >= 14 then 2 else 1 end) - coalesce(i.keepers_set, 0))) as gk
      from todo t
      left join team_info i on i.team_id = t.team_id
  ),
  plan as (
    select z.player_id,
           case
             when z.rn <= z.gk then 'goalkeeper'
             when (z.rn - z.gk) <= round((z.n - z.gk) * 0.40)                          then 'defender'
             when (z.rn - z.gk) <= round((z.n - z.gk) * 0.40) + round((z.n - z.gk) * 0.35) then 'midfielder'
             else 'forward'
           end as new_pos
      from sized z
  )
  update public.player p
     set playing_position = plan.new_pos
    from plan
   where p.id = plan.player_id
     and p.playing_position is null;

  get diagnostics v_changed = row_count;
  raise notice 'Set a position for % player(s).', v_changed;
end $$;

-- Check the result: how many of each position, per team.
select t.name as team,
       count(*) filter (where p.playing_position = 'goalkeeper') as gk,
       count(*) filter (where p.playing_position = 'defender')   as df,
       count(*) filter (where p.playing_position = 'midfielder') as mf,
       count(*) filter (where p.playing_position = 'forward')    as fw,
       count(*) filter (where p.playing_position is null)        as none,
       count(*)                                                  as players
  from public.registration r
  join public.player p on p.id = r.player_id
  join public.team t   on t.id = r.team_id
 where r.status in ('active', 'suspended')
 group by t.name
 order by t.name;
