import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const PHOTO_COUNT = 26;
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 9 * 60_000;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function parseArgs() {
  const [baseUrl, photoDirectory, outputPath, existingUserId] = process.argv.slice(2);
  if (!baseUrl || !photoDirectory || !outputPath) {
    throw new Error(
      "Usage: node --env-file=.env.local scripts/run-production-e2e.mjs <base-url> <photo-directory> <output-path> [existing-user-id]",
    );
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    photoDirectory: resolve(photoDirectory),
    outputPath: resolve(outputPath),
    existingUserId: existingUserId || null,
  };
}

async function requestJson(baseUrl, path, cookieHeader, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Cookie: cookieHeader,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const code = value && typeof value.error === "string" ? value.error : "unknown";
    const message = value && typeof value.message === "string" ? value.message : "request failed";
    throw new Error(`${path}: ${response.status} ${code} ${message}`);
  }
  return value;
}

async function loadPhotos(directory) {
  const names = (await readdir(directory))
    .filter((name) => [".jpg", ".jpeg"].includes(extname(name).toLowerCase()))
    .toSorted();
  if (names.length !== PHOTO_COUNT) {
    throw new Error(`Expected ${PHOTO_COUNT} JPEG files, found ${names.length}`);
  }
  return Promise.all(names.map(async (name) => ({
    name,
    data: await readFile(resolve(directory, name)),
  })));
}

async function createAuthenticatedClients(existingUserId) {
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const password = randomBytes(32).toString("base64url");
  let userId;
  let email;
  if (existingUserId) {
    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
      existingUserId,
      { password },
    );
    if (updateError || !updated.user?.email) {
      throw updateError ?? new Error("Failed to load existing E2E user");
    }
    userId = updated.user.id;
    email = updated.user.email;
  } else {
    const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    email = `last-screen-e2e-${suffix}@example.invalid`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) throw createError ?? new Error("Failed to create E2E user");
    userId = created.user.id;
  }

  const cookieJar = new Map();
  const user = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) cookieJar.set(name, value);
          else cookieJar.delete(name);
        }
      },
    },
  });
  const { error: signInError } = await user.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const cookieHeader = [...cookieJar]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (!cookieHeader) throw new Error("Supabase did not issue an auth cookie");
  return { user, userId, cookieHeader };
}

async function uploadAndRegisterPhotos({ baseUrl, photos, user, userId, cookieHeader }) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  for (const [index, photo] of photos.entries()) {
    const digest = createHash("sha256").update(photo.data).digest("hex").slice(0, 12);
    const storagePath = `${userId}/production-e2e/${runId}/${String(index + 1).padStart(2, "0")}-${digest}.jpg`;
    const { error: uploadError } = await user.storage
      .from("photos")
      .upload(storagePath, photo.data, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw uploadError;
    await requestJson(baseUrl, "/api/photos", cookieHeader, {
      method: "POST",
      body: JSON.stringify({ storagePath }),
    });
    process.stdout.write(`photo ${index + 1}/${photos.length} registered\n`);
  }
}

async function waitForMovie(baseUrl, movieId, cookieHeader) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let previousStatus = null;
  while (Date.now() < deadline) {
    const movie = await requestJson(baseUrl, `/api/movies/${movieId}`, cookieHeader);
    if (movie.status !== previousStatus) {
      process.stdout.write(`movie status: ${movie.status}\n`);
      previousStatus = movie.status;
    }
    if (movie.status === "completed") return movie;
    if (movie.status === "failed") {
      throw new Error(`Movie generation failed: ${movie.errorMessage ?? "unknown"}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  throw new Error("Movie generation did not finish within 9 minutes");
}

async function main() {
  const { baseUrl, photoDirectory, outputPath, existingUserId } = parseArgs();
  const photos = await loadPhotos(photoDirectory);
  const { user, userId, cookieHeader } = await createAuthenticatedClients(existingUserId);
  process.stdout.write(`demo user ${existingUserId ? "resumed" : "created"}: ${userId}\n`);
  if (existingUserId) {
    const registered = await requestJson(baseUrl, "/api/photos", cookieHeader);
    if (registered.items.length !== PHOTO_COUNT) {
      throw new Error(`Expected ${PHOTO_COUNT} registered photos, found ${registered.items.length}`);
    }
    process.stdout.write(`photos already registered: ${registered.items.length}\n`);
  } else {
    await uploadAndRegisterPhotos({ baseUrl, photos, user, userId, cookieHeader });
  }

  const obsession = await requestJson(baseUrl, "/api/obsessions", cookieHeader, {
    method: "POST",
  });
  process.stdout.write(`obsession created: ${obsession.id}\n`);
  const createdMovie = await requestJson(baseUrl, "/api/movies", cookieHeader, {
    method: "POST",
    body: JSON.stringify({ obsessionId: obsession.id }),
  });
  process.stdout.write(`movie created: ${createdMovie.id}\n`);
  const movie = await waitForMovie(baseUrl, createdMovie.id, cookieHeader);
  if (!movie.videoUrl) throw new Error("Completed movie has no signed video URL");
  const videoResponse = await fetch(movie.videoUrl);
  if (!videoResponse.ok) throw new Error(`Video download failed: ${videoResponse.status}`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, new Uint8Array(await videoResponse.arrayBuffer()));
  process.stdout.write(`${JSON.stringify({
    userId,
    photoCount: photos.length,
    obsessionId: obsession.id,
    movieId: movie.id,
    status: movie.status,
    output: basename(outputPath),
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
