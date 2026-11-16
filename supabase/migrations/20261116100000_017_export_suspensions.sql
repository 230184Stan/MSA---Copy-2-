/*
# 017 — Full suspension records for the data export

Suspensions are not directly readable (see migration 011). The data export needs the complete
records, including the match each ban came from and the matches already served, so it can be
re-created in another database.

export_suspensions(player_ids) returns them as JSON:
  { "suspension":       [ ...suspension rows... ],
    "suspension_match": [ ...matches served... ] }

Same visibility as my_suspensions(): an administrator sees every player; a club manager sees
only players currently registered to their own club. Nobody else gets anything.

Safe to run more than once.
*/

create or replace function public.export_suspensions(p_player_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.my_role() as role, public.my_club_id() as club),
  allowed as (
    select s.*
      from public.suspension s
     where s.player_id = any (p_player_ids)
       and (
         (select role from me) = 'admin'
         or (
           (select role from me) = 'club_manager'
           and exists (
             select 1
               from public.registration r
               join public.team t on t.id = r.team_id
              where r.player_id = s.player_id
                and r.status = 'active'
                and t.club_id = (select club from me)
           )
         )
       )
  )
  select jsonb_build_object(
    'suspension',
      coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'player_id', a.player_id, 'competition_id', a.competition_id,
          'source_match_id', a.source_match_id, 'source_event_id', a.source_event_id,
          'reason', a.reason, 'matches_banned', a.matches_banned, 'status', a.status,
          'notes', a.notes, 'created_at', a.created_at)
        order by a.created_at) from allowed a), '[]'::jsonb),
    'suspension_match',
      coalesce((select jsonb_agg(jsonb_build_object(
          'suspension_id', m.suspension_id, 'match_id', m.match_id))
        from public.suspension_match m
        where m.suspension_id in (select id from allowed)), '[]'::jsonb)
  );
$$;

revoke all on function public.export_suspensions(uuid[]) from public, anon;
grant execute on function public.export_suspensions(uuid[]) to authenticated;
