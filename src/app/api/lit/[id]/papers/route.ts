import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { LitError, MAX_PDF_BYTES, addPdf, getReview } from "@/server/lit";
import { canUse, toolAccessFor } from "@/server/toolAccess";
import { hit, readBody } from "@/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Uploads one PDF (the page sends files one at a time so each shows its own progress and result). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  if (!(await hit(db, `lit:upload:${session.user.id}`, 300, 3600))) return NextResponse.json({ error: "That's a lot of uploads in one hour. Please wait a little and try again." }, { status: 429 });
  try {
    const r = await getReview(db, session.user.id, id);
    if (!r) return NextResponse.json({ error: "Review not found." }, { status: 404 });
    // the client needs an active trial; an expert delivering a paid retrieval job does not
    if (r.role === "owner" && !canUse(await toolAccessFor(db, "lit", session.user))) return NextResponse.json({ error: "Your free trial has ended. Upgrade to add papers." }, { status: 403 });
    const name = decodeURIComponent(req.headers.get("x-file-name") ?? "paper.pdf");
    const note = decodeURIComponent(req.headers.get("x-note") ?? "");
    const bytes = await readBody(req, MAX_PDF_BYTES);
    if (!bytes) return NextResponse.json({ error: "That PDF is larger than 40 MB." }, { status: 400 });
    const out = await addPdf(db, session.user.id, id, bytes, name, { note });
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof LitError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("lit upload", err);
    return NextResponse.json({ error: "That PDF couldn't be added. Please try again." }, { status: 500 });
  }
}
