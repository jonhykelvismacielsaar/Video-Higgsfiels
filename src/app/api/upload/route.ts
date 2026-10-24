import { NextResponse } from "next/server";

import { saveUploadedFile } from "@/generation/storage";

/* Local uploads. The studio posts one file per request and gets back the path
   it can attach to a prompt — no blob token, no third-party bucket. Anyone who
   can reach the studio can upload; run it on a machine you trust. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file in the request" }, { status: 400 });
    }
    const stored = await saveUploadedFile(file);
    return NextResponse.json(stored, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
