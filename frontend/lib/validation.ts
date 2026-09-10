import { z } from "zod";

export const createDiarySchema = z.object({
  content: z.string().min(1).max(10_000),
});

export const createPhotoSchema = z.object({
  storagePath: z.string().min(1),
  diaryId: z.uuid().nullable().optional(),
});

export const createMovieSchema = z.object({
  obsessionId: z.uuid(),
});

export const movieIdSchema = z.uuid();
