-- The browser can insert photos rows directly. Enforce the same exact
-- {user_id}/{filename} ownership rule as POST /api/photos so the movie worker's
-- service-role client can never sign another user's private object.
drop policy "insert own photos" on public.photos;

create policy "insert own photos" on public.photos
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and storage_path like auth.uid()::text || '/%'
    and char_length(storage_path) > char_length(auth.uid()::text) + 1
    and storage_path not like auth.uid()::text || '/%/%'
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
