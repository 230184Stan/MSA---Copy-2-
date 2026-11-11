/*
# 011 — Cards and suspensions (Phase 8)

## How it works
1. A referee (or admin) records match events: goal, yellow_card, red_card, substitution.
   Each event must name a player registered to one of the two teams in that match.
2. Cards create suspensions AUTOMATICALLY (rules are in discipline_settings, admin-editable):
     - red card                        -> ban of `red_card_matches` matches        (default 1)
     - every `yellow_card_limit`-th yellow in the same competition -> ban of `yellow_ban_matches` (default 3 -> 1)
   Deleting the card event (a recording mistake) cancels a ban that has not been served yet.
   A second yellow in one match should be recorded as a red card.
3. A ban is SERVED by the player's team playing its next matches in that competition:
   when a match becomes completed/forfeit it counts once for each applicable ban.
     - the match where the card was shown never counts
     - only matches kicking off AFTER the card's match count
     - matches in other competitions never count (unless an admin ban is "any competition")
   If a result is corrected (match moved back out of completed) the count is undone, and it
   cannot be double-counted (one row per ban per match).
   A card entered LATE (after the team's next match was already completed) still counts the
   matches already played after it.
4. A suspended player cannot start or complete a division move.
5. Admins can add a manual ban (reason required) or cancel one.

## Access
- suspension tables are not directly readable: the app uses my_suspensions() (admin = all,
  club manager = their club's players) and match_roster() (admin or the ASSIGNED referee).
- Referees get to see player photos only for players on a match they are assigned to,
  within 7 days either side of kick-off.

Known gap: there is no match-day squad table yet, so a suspended player is FLAGGED on the
roster but nothing stops a name being entered. That comes with squad selection.
*/

-- ---------- settings (exactly one row) ----------
create table if not exists public.discipline_settings (
  id                 boolean primary key default true check (id),
  red_card_matches   integer not null default 1 check (red_card_matches between 1 and 50),
  yellow_card_limit  integer not null default 3 check (yellow_card_limit between 1 and 20),
  yellow_ban_matches integer not null default 1 check (yellow_ban_matches between 1 and 50),
  updated_at         timestamptz not null default now()
);
insert into public.discipline_settings (id) values (true) on conflict do nothing;

-- ---------- suspensions ----------
create table if not exists public.suspension (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references public.player(id) on delete cascade,
  competition_id   uuid references public.competition(id) on delete set null,
  source_match_id  uuid references public.match(id) on delete set null,
  source_event_id  uuid references public.match_event(id) on delete set null,
  reason           text not null check (reason in ('red_card','yellow_accumulation','admin')),
  matches_banned   integer not null check (matches_banned between 1 and 50),
  status           text not null default 'active' check (status in ('active','served','cancelled')),
  notes            text,
  created_by       uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now()
);
create index if not exists suspension_player_idx on public.suspension (player_id) where status = 'active';
create index if not exists suspension_event_idx  on public.suspension (source_event_id);

-- one row per (ban, match): makes serving idempotent
create table if not exists public.suspension_match (
  suspension_id uuid not null references public.suspension(id) on delete cascade,
  match_id      uuid not null references public.match(id) on delete cascade,
  primary key (suspension_id, match_id)
);

alter table public.discipline_settings enable row level security;
alter table public.suspension          enable row level security;
alter table public.suspension_match    enable row level security;

drop policy if exists discipline_settings_read  on public.discipline_settings;
drop policy if exists discipline_settings_admin on public.discipline_settings;
create policy discipline_settings_read  on public.discipline_settings for select to authenticated using (true);
create policy discipline_settings_admin on public.discipline_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- suspension / suspension_match: no direct access at all (functions only)
revoke all on public.suspension, public.suspension_match from anon, authenticated;
revoke all on public.discipline_settings from anon;
grant select, update on public.discipline_settings to authenticated;

-- ---------- helper ----------
create or replace function public.is_player_suspended(p_player uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.suspension where player_id = p_player and status = 'active') $$;
revoke execute on function public.is_player_suspended(uuid) from public, anon, authenticated;

-- ---------- a card/goal must belong to a player on one of the two teams ----------
create or replace function public.match_event_check()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  m public.match%rowtype;
  r public.registration%rowtype;
begin
  if new.registration_id is null then
    if new.event_type in ('yellow_card','red_card') then
      raise exception 'Choose the player who received the card.';
    end if;
    return new;
  end if;
  select * into m from public.match where id = new.match_id;
  select * into r from public.registration where id = new.registration_id;
  if r.id is null or r.team_id not in (m.home_team_id, m.away_team_id) then
    raise exception 'That player is not on either team in this match.';
  end if;
  return new;
end;
$$;
revoke execute on function public.match_event_check() from public, anon, authenticated;
drop trigger if exists match_event_check_trg on public.match_event;
create trigger match_event_check_trg
  before insert or update of match_id, registration_id on public.match_event
  for each row execute function public.match_event_check();

-- ---------- counts matches that were already played when a card is entered late ----------
create or replace function public.serve_suspension_from_past_matches(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.suspension_match (suspension_id, match_id)
  select s.id, m.id
    from public.suspension s
    join public.match src on src.id = s.source_match_id
    join public.registration r on r.player_id = s.player_id and r.status = 'active'
    join public.match m
      on m.status in ('completed','forfeit')
     and r.team_id in (m.home_team_id, m.away_team_id)
   where s.id = p_id and s.status = 'active'
     and (s.competition_id is null or s.competition_id = m.competition_id)
     and m.id <> s.source_match_id
     and m.kickoff_at > src.kickoff_at
   order by m.kickoff_at
   limit (select matches_banned from public.suspension where id = p_id)
  on conflict do nothing;

  update public.suspension s set status = 'served'
   where s.id = p_id and s.status = 'active'
     and (select count(*) from public.suspension_match sm where sm.suspension_id = s.id) >= s.matches_banned;
end;
$$;
revoke execute on function public.serve_suspension_from_past_matches(uuid) from public, anon, authenticated;

-- ---------- cards create suspensions ----------
create or replace function public.match_event_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  st        public.discipline_settings%rowtype;
  v_player  uuid;
  v_comp    uuid;
  v_yellows integer;
  v_susp    uuid;
begin
  if new.event_type not in ('red_card','yellow_card') or new.registration_id is null then
    return new;
  end if;
  select * into st from public.discipline_settings limit 1;
  select player_id into v_player from public.registration where id = new.registration_id;
  select competition_id into v_comp from public.match where id = new.match_id;

  if new.event_type = 'red_card' then
    insert into public.suspension (player_id, competition_id, source_match_id, source_event_id, reason, matches_banned)
    values (v_player, v_comp, new.match_id, new.id, 'red_card', st.red_card_matches)
    returning id into v_susp;
  else
    select count(*) into v_yellows
      from public.match_event e
      join public.registration r on r.id = e.registration_id
      join public.match m on m.id = e.match_id
     where r.player_id = v_player and m.competition_id = v_comp and e.event_type = 'yellow_card';
    if v_yellows % st.yellow_card_limit = 0 then
      insert into public.suspension (player_id, competition_id, source_match_id, source_event_id, reason, matches_banned)
      values (v_player, v_comp, new.match_id, new.id, 'yellow_accumulation', st.yellow_ban_matches)
      returning id into v_susp;
    end if;
  end if;
  if v_susp is not null then
    perform public.serve_suspension_from_past_matches(v_susp);
  end if;
  return new;
end;
$$;
revoke execute on function public.match_event_after_insert() from public, anon, authenticated;
drop trigger if exists match_event_after_insert_trg on public.match_event;
create trigger match_event_after_insert_trg
  after insert on public.match_event
  for each row execute function public.match_event_after_insert();

-- deleting a mistaken card cancels a ban that has not been served
create or replace function public.match_event_before_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.suspension
     set status = 'cancelled',
         notes = coalesce(notes || ' ', '') || '(Cancelled: the card was removed from the match record.)'
   where source_event_id = old.id and status = 'active';
  return old;
end;
$$;
revoke execute on function public.match_event_before_delete() from public, anon, authenticated;
drop trigger if exists match_event_before_delete_trg on public.match_event;
create trigger match_event_before_delete_trg
  before delete on public.match_event
  for each row execute function public.match_event_before_delete();

-- ---------- serving bans when a match is completed (and undoing it) ----------
create or replace function public.match_status_serves_bans()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  was_done boolean := old.status in ('completed','forfeit');
  is_done  boolean := new.status in ('completed','forfeit');
begin
  if is_done and not was_done then
    insert into public.suspension_match (suspension_id, match_id)
    select s.id, new.id
      from public.suspension s
      join public.registration r
        on r.player_id = s.player_id and r.status = 'active'
       and r.team_id in (new.home_team_id, new.away_team_id)
      left join public.match src on src.id = s.source_match_id
     where s.status = 'active'
       and (s.competition_id is null or s.competition_id = new.competition_id)
       and s.source_match_id is distinct from new.id
       and new.kickoff_at > coalesce(src.kickoff_at, s.created_at)
    on conflict do nothing;
  elsif was_done and not is_done then
    delete from public.suspension_match where match_id = new.id;
  else
    return new;
  end if;

  update public.suspension s set status = 'served'
   where s.status = 'active'
     and (select count(*) from public.suspension_match sm where sm.suspension_id = s.id) >= s.matches_banned;
  update public.suspension s set status = 'active'
   where s.status = 'served'
     and (select count(*) from public.suspension_match sm where sm.suspension_id = s.id) < s.matches_banned;
  return new;
end;
$$;
revoke execute on function public.match_status_serves_bans() from public, anon, authenticated;
drop trigger if exists match_status_serves_bans_trg on public.match;
create trigger match_status_serves_bans_trg
  after update of status on public.match
  for each row when (old.status is distinct from new.status)
  execute function public.match_status_serves_bans();

-- ---------- suspended players cannot move divisions ----------
create or replace function public.division_move_suspension_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status in ('requested','club_approved','completed') and public.is_player_suspended(new.player_id) then
    raise exception 'This player is suspended and cannot move divisions until the suspension has been served.';
  end if;
  return new;
end;
$$;
revoke execute on function public.division_move_suspension_guard() from public, anon, authenticated;
drop trigger if exists division_move_suspension_guard_trg on public.division_move;
create trigger division_move_suspension_guard_trg
  before insert or update of status on public.division_move
  for each row execute function public.division_move_suspension_guard();

-- ---------- admin actions ----------
create or replace function public.add_suspension(p_player_id uuid, p_matches integer, p_notes text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id    uuid;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only administrators can add a suspension.';
  end if;
  if p_matches is null or p_matches < 1 or p_matches > 50 then
    raise exception 'Enter a number of matches between 1 and 50.';
  end if;
  if v_notes is null then
    raise exception 'Please give a reason for the suspension.';
  end if;
  if not exists (select 1 from public.player where id = p_player_id) then
    raise exception 'Player not found.';
  end if;
  insert into public.suspension (player_id, competition_id, reason, matches_banned, notes)
  values (p_player_id, null, 'admin', p_matches, v_notes)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cancel_suspension(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only administrators can cancel a suspension.';
  end if;
  select status into v_status from public.suspension where id = p_id for update;
  if v_status is null then
    raise exception 'Suspension not found.';
  end if;
  if v_status <> 'active' then
    raise exception 'This suspension is already %.', v_status;
  end if;
  update public.suspension
     set status = 'cancelled',
         notes = coalesce(notes || ' ', '') || '(Cancelled by an administrator' || coalesce(': ' || v_reason, '') || '.)'
   where id = p_id;
end;
$$;

-- ---------- reading (scoped to the caller) ----------
create or replace function public.my_suspensions()
returns table (
  id uuid, player_id uuid, player_name text, photo_path text,
  team_name text, club_name text, competition_name text,
  reason text, matches_banned integer, matches_served integer, matches_remaining integer,
  status text, notes text, source_label text, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  with me as (select public.my_role() as role, public.my_club_id() as club)
  select s.id, s.player_id, p.full_name, p.photo_path,
         ar.team_name, ar.club_name, c.name,
         s.reason, s.matches_banned,
         coalesce(sm.n, 0)::int,
         greatest(s.matches_banned - coalesce(sm.n, 0), 0)::int,
         s.status, s.notes,
         case when src.id is not null then
           th.name || ' v ' || ta.name || ', ' ||
           to_char(src.kickoff_at at time zone 'Pacific/Port_Moresby', 'DD Mon YYYY')
         end,
         s.created_at
    from public.suspension s
    join public.player p on p.id = s.player_id
    left join public.competition c on c.id = s.competition_id
    left join public.match src on src.id = s.source_match_id
    left join public.team th on th.id = src.home_team_id
    left join public.team ta on ta.id = src.away_team_id
    left join lateral (
      select t.name as team_name, cl.name as club_name, t.club_id
        from public.registration r
        join public.team t on t.id = r.team_id
        join public.club cl on cl.id = t.club_id
       where r.player_id = s.player_id and r.status = 'active'
       limit 1
    ) ar on true
    left join lateral (
      select count(*) as n from public.suspension_match m where m.suspension_id = s.id
    ) sm on true
   where (select role from me) = 'admin'
      or ((select role from me) = 'club_manager' and ar.club_id = (select club from me))
   order by (s.status = 'active') desc, s.created_at desc
$$;

create or replace function public.match_roster(p_match_id uuid)
returns table (
  registration_id uuid, player_id uuid, player_name text, photo_path text,
  team_id uuid, team_name text, side text, suspended boolean, matches_remaining integer
)
language sql stable security definer set search_path = public
as $$
  select r.id, p.id, p.full_name, p.photo_path, t.id, t.name,
         case when t.id = m.home_team_id then 'home' else 'away' end,
         coalesce(sr.remaining, 0) > 0,
         coalesce(sr.remaining, 0)::int
    from public.match m
    join public.registration r
      on r.team_id in (m.home_team_id, m.away_team_id) and r.status in ('active','suspended')
    join public.player p on p.id = r.player_id
    join public.team t on t.id = r.team_id
    left join lateral (
      select max(s.matches_banned - (select count(*) from public.suspension_match sm where sm.suspension_id = s.id)) as remaining
        from public.suspension s
       where s.player_id = p.id and s.status = 'active'
    ) sr on true
   where m.id = p_match_id
     and (public.is_admin() or m.referee_id = auth.uid())
   order by (t.id = m.home_team_id) desc, p.full_name
$$;

-- ---------- referees may see photos of players on THEIR match (7 days either side) ----------
create or replace function public.referee_can_see_player(p_player_folder text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.my_role() = 'referee' and exists (
    select 1
      from public.match m
      join public.registration r
        on r.team_id in (m.home_team_id, m.away_team_id) and r.status in ('active','suspended')
     where m.referee_id = auth.uid()
       and r.player_id::text = p_player_folder
       and m.kickoff_at between now() - interval '7 days' and now() + interval '7 days'
  )
$$;
grant execute on function public.referee_can_see_player(text) to authenticated;
revoke execute on function public.referee_can_see_player(text) from public, anon;

drop policy if exists player_photos_read_referee on storage.objects;
create policy player_photos_read_referee on storage.objects
  for select to authenticated
  using (
    bucket_id = 'player-photos'
    and public.referee_can_see_player((storage.foldername(objects.name))[1])
  );

-- ---------- who may call what ----------
revoke execute on function public.add_suspension(uuid, integer, text)  from public, anon;
revoke execute on function public.cancel_suspension(uuid, text)        from public, anon;
revoke execute on function public.my_suspensions()                     from public, anon;
revoke execute on function public.match_roster(uuid)                   from public, anon;
grant  execute on function public.add_suspension(uuid, integer, text)  to authenticated;
grant  execute on function public.cancel_suspension(uuid, text)        to authenticated;
grant  execute on function public.my_suspensions()                     to authenticated;
grant  execute on function public.match_roster(uuid)                   to authenticated;
