/* Server-only storage for this fork.

   The upstream studio uploads to Vercel Blob and needs a read-write token for
   it. Here the browser's files never leave the machine: uploads land in
   `.data/uploads`, rendered videos in `.data/renders`, and both are served back
   through `/api/media/[name]`. That keeps the studio usable with no third-party
   account at all. */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.env.OHF_DATA_DIR
  ? path.resolve(process.env.OHF_DATA_DIR)
  : path.join(process.cwd(), ".data");

export const DATA_DIR = ROOT;
export const UPLOAD_DIR = path.join(ROOT, "uploads");
export const RENDER_DIR = path.join(ROOT, "renders");
export const TMP_DIR = path.join(ROOT, "tmp");

/** Mirrors ROLE_ACCEPT in the studio's data module and the old blob route. */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
};

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export async function ensureDataDirs(): Promise<void> {
  await Promise.all([
    mkdir(UPLOAD_DIR, { recursive: true }),
    mkdir(RENDER_DIR, { recursive: true }),
    mkdir(TMP_DIR, { recursive: true }),
  ]);
}

export function mediaPathFor(name: string): string {
  return `/api/media/${name}`;
}

export async function saveUploadedFile(file: File): Promise<{ name: string; path: string }> {
  const extension = ALLOWED_UPLOAD_TYPES[file.type];
  if (!extension) throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File is larger than 40 MB");
  await ensureDataDirs();
  const name = `${randomUUID()}${extension}`;
  await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));
  return { name, path: mediaPathFor(name) };
}

export function safeMediaName(raw: string): string | null {
  return NAME.test(raw) && !raw.includes("..") ? raw : null;
}

export async function existingMediaPath(name: string): Promise<string | null> {
  const safe = safeMediaName(name);
  if (!safe) return null;
  for (const dir of [UPLOAD_DIR, RENDER_DIR]) {
    const candidate = path.join(dir, safe);
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      /* try the next directory */
    }
  }
  return null;
}

/** Maps an absolute or relative studio media URL back to the file on disk, so a
    render never has to round-trip through the network to read its own input. */
export async function resolveLocalMediaUrl(urlOrPath: string): Promise<string | null> {
  if (!urlOrPath) return null;
  let pathname = urlOrPath;
  try {
    pathname = new URL(urlOrPath, "http://local").pathname;
  } catch {
    return null;
  }
  const prefix = "/api/media/";
  if (!pathname.startsWith(prefix)) return null;
  return existingMediaPath(decodeURIComponent(pathname.slice(prefix.length)));
}

const RENDER_TTL_MS = 6 * 60 * 60 * 1000;

/** Renders and uploads are the studio's cache, not its archive: anything older
    than a session's length is dropped so the folder cannot grow forever. */
export async function sweepOldFiles(maxAgeMs = RENDER_TTL_MS): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  for (const dir of [RENDER_DIR, TMP_DIR]) {
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    await Promise.all(
      names.map(async (name) => {
        const target = path.join(dir, name);
        try {
          const info = await stat(target);
          if (info.isFile() && info.mtimeMs < cutoff) await unlink(target);
        } catch {
          /* a file that vanished under us is already swept */
        }
      }),
    );
  }
}
