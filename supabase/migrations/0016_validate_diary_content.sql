-- Authenticated clients can insert into diaries directly under RLS, bypassing
-- the API's Zod schema. NOT VALID preserves any legacy rows while enforcing
-- this constraint for every new insert and update.
alter table public.diaries
  add constraint diaries_content_length_check
  check (
    char_length(btrim(content)) >= 1
    and char_length(content) <= 10000
  ) not valid;
