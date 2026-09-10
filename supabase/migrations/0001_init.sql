-- Supabase Auth の auth.users を拡張するプロフィールテーブル
create table users (
  id          uuid primary key references auth.users(id),
  display_name text,
  created_at  timestamptz not null default now()
);

create table diaries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);

create table photos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  diary_id      uuid references diaries(id) on delete set null, -- 日記に紐付かない単体アップロードも許容
  storage_path  text not null,      -- Supabase Storage 上のパス
  created_at    timestamptz not null default now()
);

create table obsessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  title         text not null,       -- 例: "夜の電車"
  reason        text,                -- AIが導き出した根拠の要約
  analysis_json jsonb not null,      -- 6章 契約①の出力そのまま
  created_at    timestamptz not null default now()
);

create table movies (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  obsession_id   uuid not null references obsessions(id) on delete cascade,
  status         text not null default 'pending'
                 check (status in ('pending','analyzing','generating','processing','completed','failed')),
  movie_json     jsonb,             -- 6章 契約②の出力(章構成・シーン台本)
  video_path     text,              -- 完成後の Supabase Storage パス
  error_message  text,              -- failed 時の原因(補完項目)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "own folder insert"
  on storage.objects for insert
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own folder select"
  on storage.objects for select
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
