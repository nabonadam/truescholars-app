import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { LitError, MAX_PDF_BYTES, attachPdf, paperFile } from "@/server/lit";
import { readBody } from "@/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The paper's PDF, for the review's owner or its expert. */
export async function GET(_req: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Sign in required", { status: 401 });
  const { paperId } = await params;
  const f = await paperFile(getDb(), session.user.id, paperId).catch(() => null);
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(f.bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}

/** Attaches a PDF to a paper listed only by its DOI. */
export async function PUT(req: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { paperId } = await params;
  try {
    const bytes = await readBody(req, MAX_PDF_BYTES);
    if (!bytes) return NextResponse.json({ error: "That PDF is larger than 40 MB." }, { status: 400 });
    await attachPdf(getDb(), session.user.id, paperId, bytes);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof LitError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("lit attach", err);
    return NextResponse.json({ error: "That PDF couldn't be attached." }, { status: 500 });
  }
}
