-- Allow the browser client to roll back a Storage upload when the matching
-- photos table insert fails. The folder check limits deletion to the owner.
create policy "own folder delete photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
