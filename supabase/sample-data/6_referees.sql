-- Creates referee logins. Paste into Supabase > SQL Editor > New query > Run.
--
-- Same password for everyone (v_password below). Change it for real use:
-- anyone who knows this file knows these passwords.
--
-- A referee has no club. An administrator assigns them to matches on the Matches page,
-- and they can then record goals and cards for those matches.
--
-- To add a referee, add a row to the list. Format:  ('login email', 'full name')
-- Safe to run again: it does not duplicate anyone. It resets that login's password, name and role.
do $$
declare
  v_password text := 'Madang2026!';
  v_made     integer := 0;
  rec        record;
  v_user     uuid;
begin
  for rec in
    select * from (values
      ('areferee@madangsa.org', 'Referee A'),
      ('breferee@madangsa.org', 'Referee B')
    ) as t(email, full_name)
  loop
    select id into v_user from auth.users where lower(email) = lower(rec.email);

    if v_user is null then
      v_user := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) values (
        '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
        rec.email, extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', rec.full_name),
        now(), now(), '', '', '', ''
      );

      insert into auth.identities (
        id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), v_user, v_user::text, 'email',
        jsonb_build_object('sub', v_user::text, 'email', rec.email, 'email_verified', true),
        now(), now(), now()
      );
    else
      update auth.users
         set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_user;
    end if;

    -- A profile row is created automatically for a new login (as a plain viewer). Make it a referee.
    insert into public.profiles (id, full_name, role, club_id)
    values (v_user, rec.full_name, 'referee', null)
    on conflict (id) do update
      set full_name = excluded.full_name, role = 'referee', club_id = null;

    v_made := v_made + 1;
  end loop;

  raise notice 'Done: % referee(s) set up.', v_made;
end $$;

-- Check the result:
select u.email, p.full_name, p.role
  from public.profiles p
  join auth.users u on u.id = p.id
 where p.role = 'referee'
 order by u.email;
