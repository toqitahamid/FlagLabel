-- Real "last seen" per user for the admin panel. last_sign_in_at only updates
-- on a fresh OTP sign-in and freezes for weeks on persistent sessions, so we
-- take the greatest of it and the user's session refresh/creation times.
-- auth.sessions is not reachable through PostgREST, hence SECURITY DEFINER.
-- Execution is restricted to service_role (the admin-users edge function).
create or replace function public.admin_last_seen()
returns table (user_id uuid, last_seen timestamptz)
language sql
security definer
set search_path = ''
as $$
  select u.id,
         greatest(
           u.last_sign_in_at,
           max(s.refreshed_at at time zone 'utc'),
           max(s.created_at)
         )
  from auth.users u
  left join auth.sessions s on s.user_id = u.id
  group by u.id, u.last_sign_in_at
$$;

revoke execute on function public.admin_last_seen() from public, anon, authenticated;
grant execute on function public.admin_last_seen() to service_role;
