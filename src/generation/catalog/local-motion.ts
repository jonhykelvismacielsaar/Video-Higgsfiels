import type { ModelEntry } from "./types";

/* The one model that runs on this machine. It takes a start frame (or none —
   the renderer draws a ground) and the prompt, and turns them into an MP4 with
   ffmpeg: camera motion, a grade, and the prompt as a caption. No key, no
   network, no per-second billing. */
export const localMotion: ModelEntry = {
  id: "local-motion",
  surface: "video",
  label: "Studio Motion",
  roles: { start: 1 },
  settings: {
    aspectRatio: { type: "enum", values: ["16:9", "9:16", "1:1"], default: "16:9" },
    resolution: { type: "enum", values: ["720p", "1080p"], default: "720p" },
    duration: { type: "range", min: 3, max: 12, default: 6, step: 1 },
    motion: { type: "enum", values: ["zoom-in", "zoom-out", "pan", "still"], default: "zoom-in" },
    look: { type: "enum", values: ["cinematic", "none", "mono", "warm"], default: "cinematic" },
    caption: { type: "boolean", default: true },
  },
  paths: { image: "local/motion", text: "local/motion" },
};
