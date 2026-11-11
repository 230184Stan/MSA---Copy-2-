/*
# Auto-create profile on signup

1. Overview
   When a new user registers via Supabase Auth, a row must exist in `profiles`
   so the role helpers (my_role, my_club_id, is_admin) return a sensible value
   instead of treating every signed-in user as 'public' with no club link.

2. Changes
   - `handle_new_user()` — a SECURITY DEFINER trigger function that inserts a
     `profiles` row with id = the new auth user, role defaulting to 'public',
     and full_name copied from raw_user_meta_data if provided at signup.
   - `on_auth_user_created` trigger on `auth.users` calling the function AFTER INSERT.

3. Security
   - The function is SECURITY DEFINER (runs as postgres) so it can insert into
     `profiles` even though the anon role normally can't write there through RLS.
   - EXECUTE is revoked from PUBLIC/anon and granted only to authenticated and
     service_role (the trigger runs as the owner, so this is belt-and-braces).
   - The function sets a strict search_path to avoid schema-injection.
*/

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'public'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon;
grant execute on function public.handle_new_user() to authenticated, service_role;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
