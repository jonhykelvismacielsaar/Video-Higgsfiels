/* Uploads land on the machine running the studio (`POST /api/upload`), not in a
   third-party bucket. The absolute URL is what the prompt carries, because a
   hosted platform — when one is configured — has to be able to fetch it. */
export async function uploadMedia(file: File): Promise<{ url: string }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body });
  const payload = (await res.json().catch(() => null)) as
    | { path?: unknown; error?: unknown }
    | null;
  if (!res.ok || typeof payload?.path !== "string") {
    const message = typeof payload?.error === "string" ? payload.error : "Upload failed";
    throw new Error(message);
  }
  return { url: new URL(payload.path, window.location.origin).toString() };
}
