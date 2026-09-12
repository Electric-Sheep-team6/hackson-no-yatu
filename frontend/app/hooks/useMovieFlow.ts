"use client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";
import { emailSchema } from "@/lib/validation";

type Diary = { id: string; content: string; createdAt: string };
type PhotoPreview = { id: string; name: string; previewUrl: string };
type Obsession = { id: string; title: string; reason: string };
type Movie = {
  id: string;
  status: string;
  errorMessage: string | null;
  videoUrl: string | null;
  movie: {
    title: string;
    scenes: { order: number; source: string; narration: string }[];
  } | null;
};

type Busy = "auth" | "diary" | "upload" | "analysis" | "movie" | null;

export type MessageTone = "success" | "error" | "info";
export type MessageArea = "auth" | "library" | "analysis" | "movie";
export type FlowMessage = {
  text: string;
  tone: MessageTone;
  area: MessageArea;
};

export type UploadProgress = { current: number; total: number };

async function responseError(response: Response) {
  return (
    (await response.json().catch(() => null))?.message ?? "通信に失敗しました。"
  );
}

export function useMovieFlow() {
  const [diaryDraft, setDiaryDraft] = useState("");
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [photoCount, setPhotoCount] = useState(0);
  const [newPhotos, setNewPhotos] = useState<PhotoPreview[]>([]);
  const [obsession, setObsession] = useState<Obsession | null>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<FlowMessage | null>(null);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<
    string | null
  >(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null,
  );

  // 破棄時に revokeObjectURL するため、最新のプレビュー一覧を ref に同期しておく。
  const newPhotosRef = useRef<PhotoPreview[]>([]);

  useEffect(() => {
    newPhotosRef.current = newPhotos;
  }, [newPhotos]);

  const showMessage = useCallback(
    (text: string, tone: MessageTone, area: MessageArea) => {
      setMessage({ text, tone, area });
    },
    [],
  );

  const revokePhotoPreviews = useCallback((photos: PhotoPreview[]) => {
    for (const photo of photos) {
      URL.revokeObjectURL(photo.previewUrl);
    }
  }, []);

  const clearUserData = useCallback(() => {
    revokePhotoPreviews(newPhotosRef.current);
    newPhotosRef.current = [];

    setDiaries([]);
    setPhotoCount(0);
    setNewPhotos([]);
    setObsession(null);
    setMovie(null);
    setUserEmail(null);
    setDiaryDraft("");
    setUploadProgress(null);
  }, [revokePhotoPreviews]);

  const refreshLibrary = useCallback(async () => {
    const [diariesResponse, photosResponse] = await Promise.all([
      fetch("/api/diaries"),
      fetch("/api/photos"),
    ]);

    if (diariesResponse.ok) {
      setDiaries(((await diariesResponse.json()) as { items: Diary[] }).items);
    }

    if (photosResponse.ok) {
      setPhotoCount(
        ((await photosResponse.json()) as { items: unknown[] }).items.length,
      );
    }
  }, []);

  const authenticate = useCallback(
    async (mode: "signIn" | "signUp") => {
      if (busy !== null) return;

      const normalizedEmail = email.trim();

      if (!emailSchema.safeParse(normalizedEmail).success) {
        showMessage("メールアドレスの形式が正しくありません。", "error", "auth");
        return;
      }

      setBusy("auth");
      setMessage(null);

      try {
        const supabase = createClient();

        const { data, error } =
          mode === "signIn"
            ? await supabase.auth.signInWithPassword({
                email: normalizedEmail,
                password,
              })
            : await supabase.auth.signUp({
                email: normalizedEmail,
                password,
                options: {
                  emailRedirectTo: `${window.location.origin}/auth/callback`,
                },
              });

        if (error) throw error;

        setUserEmail(data.session?.user.email ?? null);
        setPassword("");

        if (data.session) {
          setPendingConfirmationEmail(null);
          await refreshLibrary();
        }

        if (mode === "signUp" && !data.session) {
          setPendingConfirmationEmail(normalizedEmail);
          showMessage(
            `${normalizedEmail} 宛に確認メールを送信しました。`,
            "info",
            "auth",
          );
        } else if (mode === "signUp") {
          showMessage("アカウントを作成しました。", "success", "auth");
        } else {
          setPendingConfirmationEmail(null);
          showMessage(
            "ログインしました。保存済みの記録を読み込みました。",
            "success",
            "auth",
          );
        }
      } catch (error) {
        showMessage(
          error instanceof Error ? error.message : "認証に失敗しました。",
          "error",
          "auth",
        );
      } finally {
        setBusy(null);
      }
    },
    [busy, email, password, refreshLibrary, showMessage],
  );

  const signOut = useCallback(async () => {
    if (busy !== null) return;

    setBusy("auth");
    setMessage(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();

      if (error) throw error;

      clearUserData();
      setPendingConfirmationEmail(null);
      setPassword("");

      showMessage(
        "ログアウトしました。端末上の表示データも初期化しました。",
        "success",
        "auth",
      );
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "ログアウトに失敗しました。",
        "error",
        "auth",
      );
    } finally {
      setBusy(null);
    }
  }, [busy, clearUserData, showMessage]);

  const saveDiary = useCallback(async () => {
    if (busy !== null) return;

    if (!userEmail) {
      showMessage("日記を保存するにはログインしてください。", "error", "library");
      return;
    }

    if (!diaryDraft.trim()) return;

    setBusy("diary");
    setMessage(null);

    try {
      const response = await fetch("/api/diaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: diaryDraft.trim() }),
      });

      if (!response.ok) throw new Error(await responseError(response));

      const diary = (await response.json()) as Diary;

      setDiaries((current) => [diary, ...current]);
      setDiaryDraft("");
      showMessage("日記を保存しました。", "success", "library");
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "日記を保存できませんでした。",
        "error",
        "library",
      );
    } finally {
      setBusy(null);
    }
  }, [busy, diaryDraft, showMessage, userEmail]);

  const uploadPhotos = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";

      if (!files.length) return;
      if (busy !== null) return;

      if (!userEmail) {
        showMessage("写真を追加するにはログインしてください。", "error", "library");
        return;
      }

      setBusy("upload");
      setMessage(null);
      setUploadProgress({ current: 1, total: files.length });

      const previews: PhotoPreview[] = [];

      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("ログインしてから写真を追加してください。");
        }

        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];

          setUploadProgress({ current: index + 1, total: files.length });

          const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;

          const { error } = await supabase.storage
            .from("photos")
            .upload(storagePath, file, { contentType: file.type });

          if (error) throw error;

          const response = await fetch("/api/photos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storagePath }),
          });

          if (!response.ok) {
            throw new Error(await responseError(response));
          }

          previews.push({
            id: crypto.randomUUID(),
            name: file.name,
            previewUrl: URL.createObjectURL(file),
          });
        }

        setNewPhotos((current) => [...previews, ...current]);
        setPhotoCount((count) => count + previews.length);

        showMessage(
          `${previews.length}枚の写真を保存しました。`,
          "success",
          "library",
        );
      } catch (error) {
        revokePhotoPreviews(previews);

        showMessage(
          error instanceof Error ? error.message : "写真を保存できませんでした。",
          "error",
          "library",
        );
      } finally {
        setUploadProgress(null);
        setBusy(null);
      }
    },
    [busy, revokePhotoPreviews, showMessage, userEmail],
  );

  const analyze = useCallback(async () => {
    if (busy !== null) return;

    if (diaries.length + photoCount === 0) {
      showMessage("先に日記または写真を保存してください。", "error", "analysis");
      return;
    }

    setBusy("analysis");
    setMessage(null);

    try {
      const response = await fetch("/api/obsessions", { method: "POST" });

      if (!response.ok) throw new Error(await responseError(response));

      const next = (await response.json()) as Obsession;

      setObsession(next);
      showMessage(
        `${diaries.length}件の日記と${photoCount}枚の写真を分析しました。`,
        "success",
        "analysis",
      );
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "分析に失敗しました。",
        "error",
        "analysis",
      );
    } finally {
      setBusy(null);
    }
  }, [busy, diaries.length, photoCount, showMessage]);

  const generate = useCallback(async () => {
    if (busy !== null) return;

    if (!obsession) {
      showMessage("先に偏愛を分析してください。", "error", "movie");
      return;
    }

    setBusy("movie");
    setMessage(null);

    try {
      const response = await fetch("/api/movies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ obsessionId: obsession.id }),
      });

      if (!response.ok) throw new Error(await responseError(response));

      const created = (await response.json()) as {
        id: string;
        status: string;
      };

      setMovie({
        ...created,
        errorMessage: null,
        videoUrl: null,
        movie: null,
      });

      showMessage(
        "映画の生成を開始しました。完了までお待ちください。",
        "info",
        "movie",
      );
    } catch (error) {
      showMessage(
        error instanceof Error
          ? error.message
          : "映画生成を開始できませんでした。",
        "error",
        "movie",
      );
      setBusy(null);
    }
  }, [busy, obsession, showMessage]);

  useEffect(() => {
    try {
      void createClient()
        .auth.getUser()
        .then(({ data }) => {
          setUserEmail(data.user?.email ?? null);

          if (data.user) {
            setPendingConfirmationEmail(null);
            void refreshLibrary();
          }
        });
    } catch {
      // env is validated when used
    }
  }, [refreshLibrary]);

  useEffect(() => {
    if (!movie || ["completed", "failed"].includes(movie.status)) return;

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/movies/${movie.id}`);

      if (!response.ok) return;

      const next = (await response.json()) as Movie;

      setMovie(next);

      if (["completed", "failed"].includes(next.status)) {
        setBusy(null);

        if (next.status === "completed") {
          showMessage("映画が完成しました。", "success", "movie");
        } else {
          showMessage(
            next.errorMessage ?? "映画生成に失敗しました。",
            "error",
            "movie",
          );
        }
      }
    }, 2_000);

    return () => window.clearInterval(timer);
  }, [movie, showMessage]);

  useEffect(() => {
    return () => {
      revokePhotoPreviews(newPhotosRef.current);
    };
  }, [revokePhotoPreviews]);

  return {
    diaryDraft,
    setDiaryDraft,
    diaries,
    photoCount,
    newPhotos,
    obsession,
    movie,
    email,
    setEmail,
    password,
    setPassword,
    userEmail,
    busy,
    message,
    pendingConfirmationEmail,
    uploadProgress,
    authenticate,
    signOut,
    saveDiary,
    uploadPhotos,
    analyze,
    generate,
  };
}
