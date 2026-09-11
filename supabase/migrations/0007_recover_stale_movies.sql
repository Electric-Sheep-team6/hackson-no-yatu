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
    and created_at < pg_catalog.now() - interval '6 minutes';

  get diagnostics recovered_count = row_count;
  return recovered_count;
end;
$$;

revoke all on function public.recover_stale_movie_generations(uuid) from public;
grant execute on function public.recover_stale_movie_generations(uuid) to service_role;
