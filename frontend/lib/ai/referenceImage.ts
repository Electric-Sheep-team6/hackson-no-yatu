import { AsyncLocalStorage } from "node:async_hooks";

const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;

export type ReferenceImage = {
  data: string;
  mimeType: string;
};

const movieImageCache = new AsyncLocalStorage<Map<string, Promise<ReferenceImage>>>();

export function beginMovieImageCache(): void {
  movieImageCache.enterWith(new Map());
}

async function readReferenceImage(response: Response): Promise<Buffer> {
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_REFERENCE_IMAGE_BYTES) throw new Error("参照画像が大きすぎます");
  if (!response.body) throw new Error("参照画像を読み取れませんでした");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REFERENCE_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("参照画像が大きすぎます");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, totalBytes);
}

async function fetchReferenceImage(url: string): Promise<ReferenceImage> {
  const response = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error("参照画像を取得できませんでした");
  const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!mimeType.startsWith("image/")) throw new Error("参照ファイルが画像ではありません");
  const image = await readReferenceImage(response);
  return { data: image.toString("base64"), mimeType };
}

export function loadReferenceImage(url: string): Promise<ReferenceImage> {
  const cache = movieImageCache.getStore();
  if (!cache) return fetchReferenceImage(url);
  const cached = cache.get(url);
  if (cached) return cached;
  const pending = fetchReferenceImage(url);
  cache.set(url, pending);
  return pending;
}
