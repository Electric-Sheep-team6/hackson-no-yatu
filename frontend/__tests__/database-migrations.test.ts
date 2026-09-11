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
});
