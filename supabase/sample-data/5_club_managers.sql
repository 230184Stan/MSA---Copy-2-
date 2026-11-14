-- Creates club manager logins and links each one to an EXISTING club.
-- Paste into Supabase > SQL Editor > New query > Run.
--
-- Everyone gets the same password (set in v_password below). Change it for real use:
-- anyone who knows this file knows these passwords.
--
-- To add a manager, add a row to the list. To remove one, delete its row.
-- Format:  ('login email', 'old email (or NULL)', 'full name', 'club name exactly as it appears on the Clubs page')
-- "old email": if that login already exists it is renamed to the new email instead of making a second account.
--
-- One account manages ONE club (that is how the app links a manager to a club).
-- If you run this again it does not duplicate anyone: it resets that person's password,
-- name, role and club to what is written here.
-- A club name that does not exist is skipped, with a message saying which.
do $$
declare
  v_password text := 'Madang2026!';
  v_made     integer := 0;
  v_skipped  integer := 0;
  rec        record;
  v_club     uuid;
  v_user     uuid;
begin
  for rec in
    select * from (values
      ('smith@madangsa.org',      null,                                'Smith',                    'Madang Rangers'),
      ('cmanager@madangsa.org',   'coastal.manager@madangsa.org',      'Coastal United Manager',   'Coastal United'),
      ('amanager@madangsa.org',   'alexishafen.manager@madangsa.org',  'Alexishafen FC Manager',   'Alexishafen FC'),
      ('rmanager@madangsa.org',   'rempi.manager@madangsa.org',        'Rempi FC Manager',         'Rempi FC'),
      ('ymanager@madangsa.org',   'yagaum.manager@madangsa.org',       'Yagaum United Manager',    'Yagaum United'),
      ('smanager@madangsa.org',   'siar.manager@madangsa.org',         'Siar Athletic Manager',    'Siar Athletic'),
      ('bmanager@madangsa.org',   'baitabag.manager@madangsa.org',     'Baitabag Youth Manager',   'Baitabag Youth'),
      ('tmanager@madangsa.org',   'transgogol.manager@madangsa.org',   'Transgogol Youth Manager', 'Transgogol Youth')
    ) as t(email, old_email, full_name, club_name)
  loop
    select id into v_club from public.club where lower(name) = lower(rec.club_name);
    if v_club is null then
      raise notice 'Skipped % : there is no club called "%".', rec.email, rec.club_name;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select id into v_user from auth.users where lower(email) = lower(rec.email);

    -- Already created earlier under the old email? Rename that login rather than adding a second one.
    if v_user is null and rec.old_email is not null then
      select id into v_user from auth.users where lower(email) = lower(rec.old_email);
      if v_user is not null then
        update auth.users set email = rec.email, updated_at = now() where id = v_user;
        update auth.identities
           set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(rec.email::text)),
               updated_at = now()
         where user_id = v_user and provider = 'email';
      end if;
    end if;

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

    -- A profile row is created automatically for a new login (as a plain viewer). Make it a manager.
    insert into public.profiles (id, full_name, role, club_id)
    values (v_user, rec.full_name, 'club_manager', v_club)
    on conflict (id) do update
      set full_name = excluded.full_name, role = 'club_manager', club_id = excluded.club_id;

    v_made := v_made + 1;
  end loop;

  raise notice 'Done: % manager(s) set up, % skipped.', v_made, v_skipped;
end $$;

-- Check the result:
select u.email, p.full_name, p.role, c.name as club
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.club c on c.id = p.club_id
 where p.role = 'club_manager'
 order by c.name;
