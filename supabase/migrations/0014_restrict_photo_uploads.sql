-- Client-side and API validation can be bypassed by calling Storage directly.
-- Enforce the same restrictions at the photos bucket boundary.
update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array['image/*']::text[]
where id = 'photos';
