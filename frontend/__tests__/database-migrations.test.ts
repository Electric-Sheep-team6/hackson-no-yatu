import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("database migrations", () => {
  it("SECURITY DEFINER関数のsearch_pathと実行権限を固定する", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0003_harden_handle_new_user.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("insert into public.users");
    expect(migration).toContain(
      "revoke all on function public.handle_new_user() from public",
    );
  });

  it("利用者ごとの実行中映画をDB制約で1件に制限する", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0004_prevent_concurrent_movies.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("create unique index");
    expect(migration).toContain("on public.movies (user_id)");
    expect(migration).toContain(
      "where status in ('pending', 'analyzing', 'generating', 'processing')",
    );
  });

  it("偏愛分析の利用枠をトランザクション内で原子的に取得する", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0005_atomic_obsession_rate_limit.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("count(*) >= 10");
    expect(migration).toContain("insert into public.obsession_analysis_requests");
    expect(migration).toContain(
      "grant execute on function public.claim_obsession_analysis(uuid) to service_role",
    );
  });

  it("利用者が自分のmoviesオブジェクトだけを読み取れる", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0006_allow_movie_playback.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("on storage.objects for select");
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("bucket_id = 'movies'");
    expect(migration).toContain(
      "(storage.foldername(name))[1] = auth.uid()::text",
    );
  });

  it("制限時間を超えた映画生成をfailedへ原子的に回収する", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0007_recover_stale_movies.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("status = 'failed'");
    expect(migration).toContain("interval '6 minutes'");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("where user_id = p_user_id");
    expect(migration).toContain("created_at < pg_catalog.now()");
    expect(migration).toContain(
      "status in ('pending', 'analyzing', 'generating', 'processing')",
    );
    expect(migration).toContain(
      "revoke all on function public.recover_stale_movie_generations(uuid) from public",
    );
    expect(migration).toContain(
      "grant execute on function public.recover_stale_movie_generations(uuid) to service_role",
    );
  });
  it("SECURITY DEFINER関数をクライアントロールから実行できなくする", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "../supabase/migrations/0008_lock_down_security_definer_execute.sql"),
      "utf8",
    );

    expect(migration).toContain("revoke execute on function public.handle_new_user() from public, anon, authenticated");
    expect(migration).toContain("revoke execute on function public.claim_obsession_analysis(uuid) from public, anon, authenticated");
    expect(migration).toContain("revoke execute on function public.recover_stale_movie_generations(uuid) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.claim_obsession_analysis(uuid) to service_role");
    expect(migration).toContain("grant execute on function public.recover_stale_movie_generations(uuid) to service_role");
  });

  it("photosとmoviesのprivate Storageバケットを冪等に作成する", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "../supabase/migrations/0009_create_storage_buckets.sql"),
      "utf8",
    );

    expect(migration).toContain("insert into storage.buckets");
    expect(migration).toContain("('photos', 'photos', false)");
    expect(migration).toContain("('movies', 'movies', false)");
    expect(migration).toContain("on conflict (id) do update");
    expect(migration).toContain("public = excluded.public");
  });

  it("利用者がメタデータ保存に失敗した自分の写真を削除できる", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0010_allow_photo_cleanup.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("on storage.objects for delete");
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("bucket_id = 'photos'");
    expect(migration).toContain(
      "(storage.foldername(name))[1] = auth.uid()::text",
    );
  });

  it("進捗更新から6分間停止した映画生成だけを回収する", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0011_recover_only_inactive_movies.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("updated_at < pg_catalog.now()");
    expect(migration).not.toContain("created_at < pg_catalog.now()");
    expect(migration).toContain("interval '6 minutes'");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "revoke execute on function public.recover_stale_movie_generations(uuid) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.recover_stale_movie_generations(uuid) to service_role",
    );
  });

  it("写真を他人の日記へ直接紐付けられない", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0012_enforce_photo_diary_ownership.sql",
      ),
      "utf8",
    );

    expect(migration).toContain('drop policy "insert own photos"');
    expect(migration).toContain("user_id = auth.uid()");
    expect(migration).toContain("diary_id is null");
    expect(migration).toContain("from public.diaries");
    expect(migration).toContain("diaries.user_id = auth.uid()");
  });

  it("Storageへ直接送信しても写真のサイズ・MIME制限を迂回できない", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0013_restrict_photo_uploads.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("update storage.buckets");
    expect(migration).toContain("file_size_limit = 10485760");
    expect(migration).toContain("allowed_mime_types = array['image/*']::text[]");
    expect(migration).toContain("where id = 'photos'");
  });

  it("登録済み写真のStorageオブジェクトを直接削除できない", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0014_only_delete_orphaned_photos.sql",
      ),
      "utf8",
    );

    expect(migration).toContain('drop policy "own folder delete photos"');
    expect(migration).toContain('create policy "own folder delete orphaned photos"');
    expect(migration).toContain("on storage.objects for delete");
    expect(migration).toContain("and not exists");
    expect(migration).toContain("from public.photos");
    expect(migration).toContain("photos.user_id = auth.uid()");
    expect(migration).toContain(
      "photos.storage_path = storage.objects.name",
    );
  });

  it("直接INSERTでも空白・1万字超の日記を保存できない", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0015_validate_diary_content.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("alter table public.diaries");
    expect(migration).toContain("add constraint diaries_content_length_check");
    expect(migration).toContain("char_length(btrim(content)) >= 1");
    expect(migration).toContain("char_length(content) <= 10000");
    expect(migration).toContain("not valid");
  });

  it("AI処理が共通対応する写真形式だけをStorageで許可する", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../supabase/migrations/0016_restrict_photo_formats.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("update storage.buckets");
    expect(migration).toContain("'image/jpeg'");
    expect(migration).toContain("'image/png'");
    expect(migration).toContain("'image/webp'");
    expect(migration).not.toContain("'image/*'");
    expect(migration).toContain("where id = 'photos'");
  });

});
