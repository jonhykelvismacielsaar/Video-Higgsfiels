/* Render a video from a still and a line of text, without the studio.

   Same code path the browser uses (src/generation/local/renderer.ts), so a good
   result here is a good result there.

     pnpm render --image public/samples/floresta-nevoa.jpg \
       --prompt "Névoa entre pinheiros ao amanhecer" \
       --out demo.mp4 --ratio 16:9 --duration 6 --motion zoom-in --look cinematic

   Flags:
     --image <path|url>   start frame; omit it and the renderer draws a ground
     --prompt <text>      the line burned into the frame
     --out <file>         where the MP4 lands (default: render.mp4)
     --ratio 16:9|9:16|1:1
     --resolution 720p|1080p
     --duration <2-15>
     --motion zoom-in|zoom-out|pan|still
     --look cinematic|none|mono|warm
     --no-caption         drop the prompt from the picture
*/

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  localJobStatus,
  submitLocalJob,
} from "../src/generation/local/renderer";
import {
  RENDER_DIR,
  UPLOAD_DIR,
  ensureDataDirs,
} from "../src/generation/storage";

const argv = process.argv.slice(2);

function flag(name: string, fallback?: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1]!.startsWith("--")
    ? argv[index + 1]
    : fallback;
}

function has(name: string): boolean {
  return argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  await ensureDataDirs();
  const out = path.resolve(flag("out", "render.mp4")!);
  const prompt = flag("prompt", "")!;
  const image = flag("image");

  if (!prompt && !image) {
    console.error(
      'Nothing to render. Pass --prompt "the line in the video" and/or --image ./still.jpg',
    );
    process.exit(1);
  }

  let imageUrl: string | undefined;
  if (image) {
    const name = `${randomUUID()}${path.extname(image) || ".jpg"}`;
    await mkdir(UPLOAD_DIR, { recursive: true });
    if (/^https?:\/\//.test(image)) {
      imageUrl = image;
    } else {
      await writeFile(path.join(UPLOAD_DIR, name), await readFile(image));
      imageUrl = `/api/media/${name}`;
    }
  }

  const queued = submitLocalJob({
    prompt,
    ...(imageUrl ? { image_url: imageUrl } : {}),
    aspect_ratio: flag("ratio", "16:9"),
    resolution: flag("resolution", "720p"),
    duration: Number(flag("duration", "6")),
    motion: flag("motion", "zoom-in"),
    look: flag("look", "cinematic"),
    caption: !has("no-caption"),
  });

  const started = Date.now();
  for (;;) {
    const status = localJobStatus(queued.requestId);
    if (status.status === "failed") {
      console.error(
        `render failed: ${typeof status.error === "string" ? status.error : "unknown"}`,
      );
      process.exit(1);
    }
    if (status.status === "completed" && status.video) {
      const file = path.join(RENDER_DIR, path.basename(status.video.url));
      await copyFile(file, out);
      console.log(
        `rendered in ${((Date.now() - started) / 1000).toFixed(1)}s → ${out}`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
