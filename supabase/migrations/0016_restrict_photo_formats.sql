-- Only formats supported by both the OpenAI image input and Gemini image
-- input may enter the end-to-end analysis and movie pipeline.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp'
]::text[]
where id = 'photos';
