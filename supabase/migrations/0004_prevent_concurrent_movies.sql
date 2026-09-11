create unique index movies_one_active_generation_per_user
  on public.movies (user_id)
  where status in ('pending', 'analyzing', 'generating', 'processing');
