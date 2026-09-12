-- Movie generation invokes a paid provider. Serialize inserts per user and
-- enforce a rolling 24-hour limit in the database so concurrent requests
-- cannot bypass it.
create or replace function public.enforce_movie_generation_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('movie-generation:' || new.user_id::text, 0)
  );

  if (
    select count(*) >= 10
    from public.movies
    where user_id = new.user_id
      and created_at >= pg_catalog.now() - interval '24 hours'
  ) then
    raise exception 'movie_generation_rate_limit' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_movie_generation_rate_limit()
  from public, anon, authenticated;

create trigger enforce_movie_generation_rate_limit
  before insert on public.movies
  for each row execute function public.enforce_movie_generation_rate_limit();
