-- Cleanup is only for an upload whose photos row was not saved. Prevent a
-- direct Storage call from deleting a registered photo and leaving stale DB
-- metadata that later breaks analysis or movie generation.
drop policy "own folder delete photos" on storage.objects;

create policy "own folder delete orphaned photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1
      from public.photos
      where photos.user_id = auth.uid()
        and photos.storage_path = storage.objects.name
    )
  );
