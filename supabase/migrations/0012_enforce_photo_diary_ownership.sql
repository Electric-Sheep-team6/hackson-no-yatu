-- The browser has direct INSERT access to photos, so ownership of an optional
-- diary relation must be enforced by RLS as well as by the API route.
drop policy "insert own photos" on public.photos;

create policy "insert own photos" on public.photos
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      diary_id is null
      or exists (
        select 1
        from public.diaries
        where diaries.id = photos.diary_id
          and diaries.user_id = auth.uid()
      )
    )
  );
