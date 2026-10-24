import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { existingMediaPath } from "@/generation/storage";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

function typeOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return TYPES[name.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/* Byte ranges matter twice here: the gallery streams finished renders with a
   <video> element, and some players will not seek without them. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  const file = await existingMediaPath(name);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const info = await stat(file);
  const headers = new Headers({
    "content-type": typeOf(name),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  });

  const range = request.headers.get("range");
  const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : info.size - 1;
    if (start >= info.size || end < start) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${info.size}` } });
    }
    const last = Math.min(end, info.size - 1);
    headers.set("content-range", `bytes ${start}-${last}/${info.size}`);
    headers.set("content-length", String(last - start + 1));
    const stream = Readable.toWeb(
      createReadStream(file, { start, end: last }),
    ) as unknown as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }

  headers.set("content-length", String(info.size));
  const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(stream, { status: 200, headers });
}
