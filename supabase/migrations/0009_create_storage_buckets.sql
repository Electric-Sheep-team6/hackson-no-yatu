-- Ensure the two application Storage buckets exist and remain private.
-- Deliberately avoid file-size/MIME limits here: the photo picker accepts
-- image/* and movie generation writes concatenated 720p MP4 output, so adding
-- restrictive limits immediately before the demo could reject valid uploads.

insert into storage.buckets (id, name, public)
values
  ('photos', 'photos', false),
  ('movies', 'movies', false)
on conflict (id) do update
set public = excluded.public;
