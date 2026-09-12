import { z } from "zod";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function isAllowedPhotoMimeType(value: string) {
  return ALLOWED_PHOTO_MIME_TYPES.some((mimeType) => mimeType === value);
}

export function isOwnedPhotoStoragePath(value: string, userId: string) {
  const [ownerId, fileName, ...extraSegments] = value.split("/");
  return ownerId === userId && Boolean(fileName) && extraSegments.length === 0;
}

export const emailSchema = z.email();

export const createDiarySchema = z.object({
  content: z.string().trim().min(1).max(10_000),
});

export const createPhotoSchema = z.object({
  storagePath: z.string().min(1).max(1_024),
  diaryId: z.uuid().nullable().optional(),
});

export const createMovieSchema = z.object({
  obsessionId: z.uuid(),
});

export const movieIdSchema = z.uuid();
