/* Local video renderer.

   The upstream studio is a client for a hosted generation platform: submit a
   prompt, poll for a finished file. This module keeps that contract but answers
   it on the machine — an uploaded still (or a generated ground when there is no
   still) becomes an MP4 with camera motion, a colour grade, and the prompt
   burned in as a caption. Same lifecycle: `submit` queues a request id and
   `status` reports queued → running → completed with a video URL.

   No model weights, no API key, no network: ffmpeg is the whole engine. */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

import type { GenerationStatus, QueuedGeneration } from "../platform";
import {
  RENDER_DIR,
  TMP_DIR,
  ensureDataDirs,
  mediaPathFor,
  resolveLocalMediaUrl,
  sweepOldFiles,
} from "../storage";

const FPS = 30;
const MAX_RENDER_MS = 180_000;
const MAX_REMOTE_BYTES = 30 * 1024 * 1024;

export type Motion = "zoom-in" | "zoom-out" | "pan" | "still";
export type Look = "none" | "cinematic" | "mono" | "warm";

export type RenderRequest = {
  prompt: string;
  imageUrl: string | null;
  aspectRatio: "16:9" | "9:16" | "1:1";
  resolution: "720p" | "1080p";
  duration: number;
  motion: Motion;
  look: Look;
  caption: boolean;
};

type LocalJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: number;
  file: string | null;
  error?: string;
};

/* Next reloads server modules on every edit in development; the jobs table has
   to outlive the module instance or a running render would vanish mid-flight. */
const GLOBAL = globalThis as typeof globalThis & {
  __ohfLocalJobs?: Map<string, LocalJob>;
};
const jobs: Map<string, LocalJob> = (GLOBAL.__ohfLocalJobs ??= new Map());

/* ------------------------------------------------------------------ public */

export function submitLocalJob(
  body: Record<string, unknown>,
): QueuedGeneration {
  const request = parseRequest(body);
  const id = randomUUID();
  jobs.set(id, { id, status: "queued", createdAt: Date.now(), file: null });
  if (jobs.size > 200) {
    const stale = [...jobs.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, 50);
    for (const job of stale) jobs.delete(job.id);
  }
  void runJob(id, request);
  return { status: "queued", requestId: id, statusUrl: "", cancelUrl: "" };
}

export function localJobStatus(requestId: string): GenerationStatus {
  const job = jobs.get(requestId);
  if (!job)
    return { status: "failed", requestId, error: "Unknown render request" };
  if (job.status === "completed" && job.file) {
    return {
      status: "completed",
      requestId,
      video: { url: mediaPathFor(job.file) },
    };
  }
  if (job.status === "failed") {
    return { status: "failed", requestId, error: job.error ?? "render failed" };
  }
  return { status: job.status, requestId };
}

/* ------------------------------------------------------------------ parsing */

function parseRequest(body: Record<string, unknown>): RenderRequest {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const imageUrl =
    typeof body.image_url === "string" && body.image_url
      ? body.image_url
      : null;
  const aspectRatio = pick(body.aspect_ratio, ["16:9", "9:16", "1:1"], "16:9");
  const resolution = pick(body.resolution, ["720p", "1080p"], "720p");
  const motion = pick(
    body.motion,
    ["zoom-in", "zoom-out", "pan", "still"],
    "zoom-in",
  );
  const look = pick(body.look, ["none", "cinematic", "mono", "warm"], "none");
  const duration = clamp(Number(body.duration) || 6, 2, 15);
  const caption = body.caption !== false;
  return {
    prompt,
    imageUrl,
    aspectRatio,
    resolution,
    duration,
    motion,
    look,
    caption,
  };
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------- render */

async function runJob(id: string, request: RenderRequest): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "running";
  try {
    job.file = await render(request, id);
    job.status = "completed";
    void sweepOldFiles();
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    console.error("[local-render] failed", job.error);
  }
}

async function render(request: RenderRequest, id: string): Promise<string> {
  const bin = ffmpegPath();
  await ensureDataDirs();
  const dir = path.join(TMP_DIR, id);
  await mkdir(dir, { recursive: true });

  const source = request.imageUrl
    ? ((await resolveLocalMediaUrl(request.imageUrl)) ??
      (await download(request.imageUrl, dir)))
    : await gradientSource(request, dir, bin);

  const graph = await buildGraph(request, dir);
  if (process.env.OHF_RENDER_DEBUG) console.info("[local-render] graph", graph);
  const output = path.join(dir, `${id}.mp4`);
  await exec(bin, [
    "-y",
    "-loglevel",
    "error",
    "-i",
    source,
    "-filter_complex",
    `${graph}[v]`,
    "-map",
    "[v]",
    "-t",
    request.duration.toFixed(2),
    "-r",
    String(FPS),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ]);

  const name = `${id}.mp4`;
  await copyFile(output, path.join(RENDER_DIR, name));
  return name;
}

function ffmpegPath(): string {
  if (process.env.FFMPEG_BIN && existsSync(process.env.FFMPEG_BIN))
    return process.env.FFMPEG_BIN;
  const bundled = (ffmpegInstaller as { path?: string }).path;
  if (bundled && existsSync(bundled)) return bundled;
  return "ffmpeg";
}

function captionFont(): string | null {
  const candidates = [
    process.env.OHF_FONT,
    path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function dimensions(request: RenderRequest): { width: number; height: number } {
  const short = request.resolution === "1080p" ? 1080 : 720;
  if (request.aspectRatio === "9:16")
    return { width: short, height: Math.round((short * 16) / 9) };
  if (request.aspectRatio === "1:1") return { width: short, height: short };
  return { width: Math.round((short * 16) / 9), height: short };
}

/* Inside a filtergraph a path is a value like any other: only ':' '\' and "'"
   have to be protected, and none of them can appear in our own temp paths. */
function escapePath(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

async function buildGraph(
  request: RenderRequest,
  dir: string,
): Promise<string> {
  const { width, height } = dimensions(request);
  const frames = Math.max(2, Math.round(request.duration * FPS));
  const big = 2;
  const chain: string[] = [
    `scale=${width * big}:${height * big}:force_original_aspect_ratio=increase`,
    `crop=${width * big}:${height * big}`,
    zoompan(request.motion, frames, width, height),
  ];

  const graded = lookChain(request.look);
  if (graded) chain.push(graded);

  chain.push("fade=t=in:st=0:d=0.6");
  chain.push(
    `fade=t=out:st=${Math.max(0, request.duration - 0.9).toFixed(2)}:d=0.9`,
  );

  const font = captionFont();
  if (font) {
    const lines = request.caption ? wrapCaption(request.prompt, width) : [];
    if (lines.length > 0) {
      const file = path.join(dir, "caption.txt");
      await writeFile(file, lines.join("\n"), "utf8");
      const size = Math.round(width * 0.032);
      chain.push(
        "drawtext=" +
          [
            `fontfile=${escapePath(font)}`,
            `textfile=${escapePath(file)}`,
            "expansion=none",
            "fontcolor=white",
            `fontsize=${size}`,
            `line_spacing=${Math.round(size * 0.32)}`,
            "x=(w-text_w)/2",
            `y=${request.aspectRatio === "9:16" ? "h*0.72" : "h*0.82"}-text_h/2`,
            "box=1",
            "boxcolor=0x000000@0.28",
            `boxborderw=${Math.round(size * 0.7)}`,
            "shadowcolor=0x000000@0.55",
            "shadowx=0",
            "shadowy=2",
            "alpha='if(lt(t,0.45),0,min(1,(t-0.45)/0.7))'",
          ].join(":"),
      );
    }
    const mark = Math.round(width * 0.014);
    chain.push(
      "drawtext=" +
        [
          `fontfile=${escapePath(font)}`,
          "text=OPEN HIGGSFIELD  ·  LOCAL RENDER",
          "expansion=none",
          "fontcolor=white@0.55",
          `fontsize=${mark}`,
          `x=${Math.round(width * 0.035)}`,
          `y=${Math.round(height * 0.045)}`,
          "shadowcolor=0x000000@0.5",
          "shadowy=1",
        ].join(":"),
    );
  }

  return chain.join(",");
}

function zoompan(
  motion: Motion,
  frames: number,
  width: number,
  height: number,
): string {
  const size = `s=${width}x${height}:fps=${FPS}`;
  const centered = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
  if (motion === "still") return `zoompan=z='1':x=0:y=0:d=${frames}:${size}`;
  if (motion === "pan") {
    return `zoompan=z='1.12':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)':d=${frames}:${size}`;
  }
  if (motion === "zoom-out") {
    return `zoompan=z='max(1.28-0.0024*on,1)':${centered}:d=${frames}:${size}`;
  }
  return `zoompan=z='min(1+0.0024*on,1.28)':${centered}:d=${frames}:${size}`;
}

function lookChain(look: Look): string | null {
  if (look === "cinematic")
    return "eq=contrast=1.08:saturation=1.05,vignette=PI/5";
  if (look === "mono") return "hue=s=0,eq=contrast=1.12";
  if (look === "warm")
    return "colorbalance=rs=0.08:bs=-0.08,eq=saturation=1.06";
  return null;
}

/* Roughly 0.55 em per character for DejaVu Sans Bold: enough to keep a caption
   inside the frame without measuring glyphs in advance. */
function wrapCaption(text: string, width: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const size = width * 0.032;
  const perLine = Math.max(12, Math.floor((width * 0.82) / (size * 0.55)));
  const words = clean.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= perLine) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === 4) break;
  }
  if (line && lines.length < 4) lines.push(line);
  if (lines.length === 4) lines[3] = `${lines[3]!.replace(/[,.;:]$/, "")}…`;
  return lines;
}

/* -------------------------------------------------------------- media input */

async function download(url: string, dir: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The start frame is not a readable URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The start frame must be an http(s) URL or an upload");
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok)
    throw new Error(`Could not read the start frame (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_REMOTE_BYTES)
    throw new Error("The start frame is larger than 30 MB");
  const type = response.headers.get("content-type") ?? "";
  const extension = type.includes("png")
    ? ".png"
    : type.includes("webp")
      ? ".webp"
      : ".jpg";
  const file = path.join(dir, `source${extension}`);
  await writeFile(file, bytes);
  return file;
}

/* Without a start frame the shot still has to exist: a two-tone ground keyed
   off the prompt — a dark field with one soft light source, grain on top —
   drawn once per hue and size, then cached. It reads as a designed title card
   rather than as a broken upload. */
async function gradientSource(
  request: RenderRequest,
  dir: string,
  bin: string,
): Promise<string> {
  const { width, height } = dimensions(request);
  const hue = hashHue(request.prompt || request.aspectRatio);
  const cached = path.join(RENDER_DIR, `bg-${hue}-${width}x${height}.png`);
  if (existsSync(cached)) return cached;

  const w = width;
  const h = height;
  const [br, bg, bb] = hsv(hue, 0.45, 0.07);
  const [ar, ag, ab] = hsv((hue + 24) % 360, 0.62, 0.62);

  /* A diagonal ramp plus a radial falloff whose centre sits off-centre: the
     frame then has a direction and a light source, which is what makes it read
     as a photograph rather than a swatch. */
  const distance = "sqrt((X/W-0.68)*(X/W-0.68)+(Y/H-0.30)*(Y/H-0.30))/0.85";
  const glow = `(max(1-${distance},0)*max(1-${distance},0))`;
  const level = `clip(0.22+0.78*(0.42*(0.55*X/W+0.45*Y/H)+0.58*${glow}),0,1)`;
  const channel = (from: number, to: number) =>
    `clip(${from}+(${to - from})*${level},0,255)`;
  const geq = `geq=r='${channel(br, ar)}':g='${channel(bg, ag)}':b='${channel(bb, ab)}',noise=alls=7:allf=t`;

  const target = path.join(dir, "ground.png");
  await exec(bin, [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${w}x${h}`,
    "-vf",
    geq,
    "-frames:v",
    "1",
    target,
  ]);
  await copyFile(target, cached).catch(() => undefined);
  return target;
}

function hashHue(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  return hash;
}

function hsv(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/* --------------------------------------------------------------------- exec */

function exec(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: MAX_RENDER_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const tail = String(stderr || error.message)
          .trim()
          .split("\n")
          .slice(-4)
          .join(" ");
        reject(new Error(tail || "ffmpeg failed"));
      },
    );
  });
}
