-- A long-running job can still be healthy after six minutes. Recover only jobs
-- that have made no progress for six minutes; the worker refreshes updated_at
-- after every generated scene.
create or replace function public.recover_stale_movie_generations(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovered_count integer;
begin
  update public.movies
  set
    status = 'failed',
    error_message = '動画生成が制限時間を超えました',
    updated_at = pg_catalog.now()
  where user_id = p_user_id
    and status in ('pending', 'analyzing', 'generating', 'processing')
    and updated_at < pg_catalog.now() - interval '6 minutes';

  get diagnostics recovered_count = row_count;
  return recovered_count;
end;
$$;

revoke execute on function public.recover_stale_movie_generations(uuid) from public, anon, authenticated;
grant execute on function public.recover_stale_movie_generations(uuid) to service_role;
