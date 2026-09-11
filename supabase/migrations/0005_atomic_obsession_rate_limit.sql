create table public.obsession_analysis_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index obsession_analysis_requests_user_created_at
  on public.obsession_analysis_requests (user_id, created_at desc);

alter table public.obsession_analysis_requests enable row level security;

create or replace function public.claim_obsession_analysis(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  if (
    select count(*) >= 10
    from public.obsession_analysis_requests
    where user_id = p_user_id
      and created_at >= pg_catalog.now() - interval '24 hours'
  ) then
    return false;
  end if;

  insert into public.obsession_analysis_requests (user_id)
  values (p_user_id);
  return true;
end;
$$;

revoke all on function public.claim_obsession_analysis(uuid) from public;
grant execute on function public.claim_obsession_analysis(uuid) to service_role;
