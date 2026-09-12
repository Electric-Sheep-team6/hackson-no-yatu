create policy "own folder select movies"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'movies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
