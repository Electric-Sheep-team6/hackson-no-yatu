-- 追加マイグレーション(docs/backend-implementation-addendum.md 9章で指摘したRLS未設定ギャップへの対応)。
-- 0001_init.sql (docs/backend-spec.md の転記、変更禁止)に対する追加のみ。
-- このプロジェクトは「Enable automatic RLS」を有効にして作成したため、
-- 0001_init.sql 実行時点で users/diaries/photos/obsessions/movies には
-- 既に RLS が有効化されている(ポリシー無し = 全拒否)。ここでは
-- API Route Handler(anonキー+ユーザーセッション)からの正当なアクセスを
-- user_id = auth.uid() の範囲でのみ許可するポリシーを追加する。
-- service_role(admin client)は常にRLSをバイパスするため対象外。

alter table users enable row level security;
alter table diaries enable row level security;
alter table photos enable row level security;
alter table obsessions enable row level security;
alter table movies enable row level security;

create policy "select own profile" on users
  for select using (id = auth.uid());

create policy "update own profile" on users
  for update using (id = auth.uid());

create policy "select own diaries" on diaries
  for select using (user_id = auth.uid());
create policy "insert own diaries" on diaries
  for insert with check (user_id = auth.uid());

create policy "select own photos" on photos
  for select using (user_id = auth.uid());
create policy "insert own photos" on photos
  for insert with check (user_id = auth.uid());

create policy "select own obsessions" on obsessions
  for select using (user_id = auth.uid());
-- obsessions の insert は API Route Handler が service_role 経由で行うため、
-- authenticated ロール向けの insert ポリシーは追加しない(補足仕様6章参照)。

create policy "select own movies" on movies
  for select using (user_id = auth.uid());
-- movies の insert/update は API Route Handler が service_role 経由で行うため、
-- authenticated ロール向けの insert/update ポリシーは追加しない。
