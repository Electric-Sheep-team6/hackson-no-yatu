export type MediaItem = {
  id: string;
  name: string;
  type: "image" | "video";
  file: File;
  previewUrl?: string;
  storagePath?: string;
};

export type Obsession = { id: string; title: string; reason: string; createdAt: string };

export type Movie = {
  id: string;
  status: "pending" | "analyzing" | "generating" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  movie: { title: string; logline: string; scenes: { order: number; source: string; narration: string }[] } | null;
};
