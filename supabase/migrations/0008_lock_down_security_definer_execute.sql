-- Remove direct client access from SECURITY DEFINER helpers.
-- Supabase grants EXECUTE to anon/authenticated by default, so revoking only
-- from PUBLIC in earlier migrations is not sufficient.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.claim_obsession_analysis(uuid) from public, anon, authenticated;
revoke execute on function public.recover_stale_movie_generations(uuid) from public, anon, authenticated;

-- These two RPCs are intentionally server-only and are called through the
-- service-role Supabase client.
grant execute on function public.claim_obsession_analysis(uuid) to service_role;
grant execute on function public.recover_stale_movie_generations(uuid) to service_role;
