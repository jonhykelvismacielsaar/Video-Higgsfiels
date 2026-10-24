import { NextResponse } from "next/server";

import { localJobStatus, submitLocalJob } from "@/generation/local/renderer";

/* The same renderer the studio calls, exposed over HTTP so a script can drive
   it: POST a prompt (and an uploaded still, if any), then poll the id.

     curl -X POST localhost:3000/api/render \
       -H 'content-type: application/json' \
       -d '{"prompt":"Névoa ao amanhecer","duration":6}'
     curl 'localhost:3000/api/render?id=<request id>'
*/
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body" }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Send a JSON object" }, { status: 400 });
  }
  try {
    const queued = submitLocalJob(body as Record<string, unknown>);
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed to start";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  return NextResponse.json(localJobStatus(id));
}
