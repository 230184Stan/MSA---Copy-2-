/*
# 009 — Division moves (Phase 6)

## The flow
  request  ->  [receiving club approves, only if the player changes club]  ->  admin approves  ->  done
  Statuses: requested -> club_approved -> completed   (or rejected at any stage)

- Club manager requests for a player at THEIR club. Their request counts as the releasing club's approval.
- Same club: goes straight to club_approved (waiting for the association).
- Different club: stays "requested" until a manager of the RECEIVING club approves.
- Admin requests skip the club approvals (the association has final say), but still need a reason
  outside a transfer window.
- Admin approval performs the move in ONE transaction: end old registration, open new one,
  log it. A player can never end up with zero or two active registrations.

## Rules enforced here
- Player must have an active (not suspended) registration in the CURRENT season.
- Target team must have a division and differ from the current team.
- Eligibility (gender / Under 18 cut-off) is re-checked at request AND at completion.
- Moving DOWN needs a reason.
- Outside a transfer window only an admin may request, and must give a reason.
  (No windows defined for the season = closed.)
- One move in progress per player.

## Closing loopholes
RLS lets club managers update/insert registrations, which would bypass this whole flow.
`guard_registration_changes` blocks non-admins from (a) changing a registration's player,
team, division or season, and (b) opening a registration in a different division from one the
player already held this season. Only the move functions (which set app.division_move) may.
Known remaining gap: a manager can still register a player who was released by ANOTHER club
into the same division. A "release/clearance" step is a later improvement.

## Also
- player_eligibility_error() is now the single source of truth; the 007 trigger calls it.
*/

-- ---------- extra columns ----------
alter table public.division_move
  add column if not exists from_team_id          uuid references public.team(id),
  add column if not exists to_team_id            uuid references public.team(id),
  add column if not exists receiving_approved_by uuid references auth.users(id),
  add column if not exists receiving_approved_at timestamptz,
  add column if not exists rejected_reason       text;

create index if not exists division_move_player_idx on public.division_move (player_id);

-- ---------- single source of truth for eligibility ----------
create or replace function public.player_eligibility_error(p_player uuid, p_division uuid, p_season uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_dob date; v_gender text;
  v_div_name text; v_rule text; v_max_age integer;
  v_season text; v_cutoff date;
begin
  select p.dob, p.gender::text into v_dob, v_gender from public.player p where p.id = p_player;
  select d.name, d.gender_rule::text, d.max_age into v_div_name, v_rule, v_max_age
    from public.division d where d.id = p_division;
  select s.name, s.cut_off_date into v_season, v_cutoff from public.season s where s.id = p_season;

  if v_dob is null or v_div_name is null then
    return 'Player or division not found.';
  end if;
  if v_rule in ('male','female') and v_gender is distinct from v_rule then
    return format('%s is for %s players only.', v_div_name, v_rule);
  end if;
  if v_max_age is not null then
    if v_cutoff is null then
      return format('Season %s has no age cut-off date set.', v_season);
    end if;
    if v_dob < v_cutoff then
      return format('%s is for players born on or after %s. This player is too old.', v_div_name, v_cutoff);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.player_eligibility_error(uuid, uuid, uuid) from public, anon, authenticated;

-- 007's trigger now delegates to it (same rules, same messages)
create or replace function public.check_registration_eligibility()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_err text;
begin
  if new.status is distinct from 'active' then
    return new;
  end if;
  v_err := public.player_eligibility_error(new.player_id, new.division_id, new.season_id);
  if v_err is not null then
    raise exception '%', v_err using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_registration_eligibility() from public, anon, authenticated;

create or replace function public.in_transfer_window(p_season uuid, p_day date default current_date)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.transfer_window w
     where w.season_id = p_season and p_day between w.opens_on and w.closes_on
  )
$$;
revoke execute on function public.in_transfer_window(uuid, date) from public, anon, authenticated;

-- ---------- loophole guard ----------
create or replace function public.guard_registration_changes()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- SQL editor / migrations (no signed-in user), admins, and the move functions are trusted.
  if auth.uid() is null
     or public.is_admin()
     or coalesce(current_setting('app.division_move', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.player_id   is distinct from old.player_id
       or new.team_id     is distinct from old.team_id
       or new.division_id is distinct from old.division_id
       or new.season_id   is distinct from old.season_id then
      raise exception 'To change a player''s team or division, request a division move.';
    end if;
  elsif tg_op = 'INSERT' and new.status = 'active' then
    if exists (
      select 1 from public.registration r
       where r.player_id = new.player_id
         and r.season_id = new.season_id
         and r.division_id <> new.division_id
    ) then
      raise exception 'This player already had a registration in another division this season. Request a division move instead.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_registration_changes() from public, anon, authenticated;

drop trigger if exists registration_guard on public.registration;
create trigger registration_guard
  before insert or update on public.registration
  for each row execute function public.guard_registration_changes();

-- ---------- request ----------
create or replace function public.request_division_move(
  p_player_id uuid, p_to_team_id uuid, p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_role   text := public.my_role();
  v_club   uuid := public.my_club_id();
  v_season uuid;
  v_reg    public.registration%rowtype;
  v_from   public.team%rowtype;
  v_to     public.team%rowtype;
  v_fdiv   public.division%rowtype;
  v_tdiv   public.division%rowtype;
  v_type   text;
  v_err    text;
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_move   uuid;
begin
  if auth.uid() is null or v_role not in ('admin','club_manager') then
    raise exception 'Only club managers and administrators can request a move.';
  end if;

  select id into v_season from public.season where is_current;
  if v_season is null then
    raise exception 'No current season is set. Ask an administrator to set one.';
  end if;

  select * into v_reg from public.registration
   where player_id = p_player_id and status in ('active','suspended')
   order by created_at desc limit 1;
  if not found then
    raise exception 'This player has no active registration.';
  end if;
  if v_reg.status = 'suspended' then
    raise exception 'A suspended player cannot move divisions.';
  end if;
  if v_reg.season_id <> v_season then
    raise exception 'This player''s registration is from a past season. Ask an administrator to renew it.';
  end if;

  select * into v_from from public.team where id = v_reg.team_id;
  select * into v_to   from public.team where id = p_to_team_id;
  if v_to.id is null then
    raise exception 'Target team not found.';
  end if;
  if v_to.division_id is null then
    raise exception 'That team is not in a division yet.';
  end if;
  if v_to.id = v_from.id then
    raise exception 'The player is already on that team.';
  end if;

  if v_role = 'club_manager' and v_from.club_id is distinct from v_club then
    raise exception 'You can only request moves for players at your own club.';
  end if;

  if exists (select 1 from public.division_move
              where player_id = p_player_id and status in ('requested','club_approved')) then
    raise exception 'This player already has a move in progress.';
  end if;

  v_err := public.player_eligibility_error(p_player_id, v_to.division_id, v_season);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  select * into v_fdiv from public.division where id = v_reg.division_id;
  select * into v_tdiv from public.division where id = v_to.division_id;
  if v_fdiv.id = v_tdiv.id or v_fdiv.level is null or v_tdiv.level is null then
    v_type := 'transfer';
  elsif v_tdiv.level < v_fdiv.level then
    v_type := 'up';
  else
    v_type := 'down';
  end if;

  if v_type = 'down' and v_reason is null then
    raise exception 'A reason is required when moving a player down a division.';
  end if;

  if not public.in_transfer_window(v_season) then
    if v_role <> 'admin' then
      raise exception 'The transfer window is closed. Only an administrator can approve an exceptional move.';
    end if;
    if v_reason is null then
      raise exception 'A reason is required for a move outside the transfer window.';
    end if;
  end if;

  v_status := case
    when v_role = 'admin' then 'club_approved'                       -- association overrides club consent
    when v_to.club_id is distinct from v_from.club_id then 'requested' -- receiving club must agree
    else 'club_approved'
  end;

  insert into public.division_move
    (player_id, from_registration_id, from_team_id, to_team_id, move_type, reason, status,
     requested_by, club_approved_by, club_approved_at)
  values
    (p_player_id, v_reg.id, v_from.id, v_to.id, v_type, v_reason, v_status,
     auth.uid(),
     case when v_role = 'club_manager' then auth.uid() end,
     case when v_role = 'club_manager' then now() end)
  returning id into v_move;

  return v_move;
end;
$$;

-- ---------- complete (internal; only approve_division_move calls this) ----------
create or replace function public.complete_division_move(p_move_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m        public.division_move%rowtype;
  v_reg    public.registration%rowtype;
  v_to     public.team%rowtype;
  v_season uuid;
  v_err    text;
  v_new    uuid;
begin
  select * into m from public.division_move where id = p_move_id for update;
  select * into v_reg from public.registration where id = m.from_registration_id;
  if v_reg.id is null or v_reg.status <> 'active' then
    raise exception 'The player''s registration has changed since this was requested. Reject this request and start a new one.';
  end if;

  select id into v_season from public.season where is_current;
  if v_season is null then
    raise exception 'No current season is set.';
  end if;
  select * into v_to from public.team where id = m.to_team_id;
  if v_to.id is null or v_to.division_id is null then
    raise exception 'The target team is no longer available.';
  end if;

  v_err := public.player_eligibility_error(m.player_id, v_to.division_id, v_season);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  perform set_config('app.division_move', 'on', true);
  update public.registration set status = 'ended', end_date = current_date where id = v_reg.id;
  insert into public.registration (player_id, team_id, division_id, season_id, status, start_date)
  values (m.player_id, v_to.id, v_to.division_id, v_season, 'active', current_date)
  returning id into v_new;
  perform set_config('app.division_move', 'off', true);

  update public.division_move
     set status = 'completed', to_registration_id = v_new,
         admin_approved_by = auth.uid(), admin_approved_at = now()
   where id = p_move_id;
end;
$$;
revoke execute on function public.complete_division_move(uuid) from public, anon, authenticated;

-- ---------- approve ----------
create or replace function public.approve_division_move(p_move_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  m          public.division_move%rowtype;
  v_role     text := public.my_role();
  v_club     uuid := public.my_club_id();
  v_from_club uuid;
  v_to_club   uuid;
begin
  if auth.uid() is null or v_role not in ('admin','club_manager') then
    raise exception 'Only club managers and administrators can approve moves.';
  end if;

  select * into m from public.division_move where id = p_move_id for update;
  if not found then
    raise exception 'Move not found.';
  end if;
  if m.status not in ('requested','club_approved') then
    raise exception 'This move is already %.', m.status;
  end if;

  select club_id into v_from_club from public.team where id = m.from_team_id;
  select club_id into v_to_club   from public.team where id = m.to_team_id;

  if v_role = 'admin' then
    if m.status <> 'club_approved' then
      raise exception 'Waiting for the receiving club to approve first.';
    end if;
    perform public.complete_division_move(p_move_id);
    return 'completed';
  end if;

  if m.status = 'requested' and v_to_club = v_club and v_from_club is distinct from v_club then
    update public.division_move
       set status = 'club_approved', receiving_approved_by = auth.uid(), receiving_approved_at = now()
     where id = p_move_id;
    return 'club_approved';
  end if;

  raise exception 'There is nothing for your club to approve on this move.';
end;
$$;

-- ---------- reject ----------
create or replace function public.reject_division_move(p_move_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m          public.division_move%rowtype;
  v_role     text := public.my_role();
  v_club     uuid := public.my_club_id();
  v_from_club uuid;
  v_to_club   uuid;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or v_role not in ('admin','club_manager') then
    raise exception 'Only club managers and administrators can reject moves.';
  end if;
  if v_reason is null then
    raise exception 'Please give a reason for rejecting this move.';
  end if;

  select * into m from public.division_move where id = p_move_id for update;
  if not found then
    raise exception 'Move not found.';
  end if;
  if m.status not in ('requested','club_approved') then
    raise exception 'This move is already %.', m.status;
  end if;

  select club_id into v_from_club from public.team where id = m.from_team_id;
  select club_id into v_to_club   from public.team where id = m.to_team_id;
  if v_role = 'club_manager' and v_club is distinct from v_from_club and v_club is distinct from v_to_club then
    raise exception 'This move does not involve your club.';
  end if;

  update public.division_move set status = 'rejected', rejected_reason = v_reason where id = p_move_id;
end;
$$;

-- ---------- list (names joined, scoped to the caller, with what they may do) ----------
create or replace function public.my_division_moves()
returns table (
  id uuid, status text, move_type text, reason text, rejected_reason text, created_at timestamptz,
  player_id uuid, player_name text,
  from_team_name text, from_club_name text, from_division_name text,
  to_team_name text, to_club_name text, to_division_name text,
  can_approve boolean, can_reject boolean
)
language sql stable security definer set search_path = public
as $$
  with me as (select public.my_role() as role, public.my_club_id() as club)
  select m.id, m.status, m.move_type, m.reason, m.rejected_reason, m.created_at,
         m.player_id, p.full_name,
         ft.name, fc.name, fd.name,
         tt.name, tc.name, td.name,
         case
           when (select role from me) = 'admin' then m.status = 'club_approved'
           when (select role from me) = 'club_manager' then
                m.status = 'requested'
                and tt.club_id = (select club from me)
                and ft.club_id is distinct from (select club from me)
           else false
         end,
         m.status in ('requested','club_approved') and (
           (select role from me) = 'admin'
           or ((select role from me) = 'club_manager'
               and (select club from me) in (ft.club_id, tt.club_id))
         )
    from public.division_move m
    join public.player p on p.id = m.player_id
    left join public.team ft on ft.id = m.from_team_id
    left join public.club fc on fc.id = ft.club_id
    left join public.registration fr on fr.id = m.from_registration_id
    left join public.division fd on fd.id = fr.division_id
    left join public.team tt on tt.id = m.to_team_id
    left join public.club tc on tc.id = tt.club_id
    left join public.division td on td.id = tt.division_id
   where (select role from me) = 'admin'
      or ((select role from me) = 'club_manager'
          and (select club from me) in (ft.club_id, tt.club_id))
   order by (m.status in ('requested','club_approved')) desc, m.created_at desc
$$;

-- ---------- who may call what ----------
revoke execute on function public.request_division_move(uuid, uuid, text) from public, anon;
revoke execute on function public.approve_division_move(uuid)             from public, anon;
revoke execute on function public.reject_division_move(uuid, text)        from public, anon;
revoke execute on function public.my_division_moves()                     from public, anon;
grant  execute on function public.request_division_move(uuid, uuid, text) to authenticated;
grant  execute on function public.approve_division_move(uuid)             to authenticated;
grant  execute on function public.reject_division_move(uuid, text)        to authenticated;
grant  execute on function public.my_division_moves()                     to authenticated;
