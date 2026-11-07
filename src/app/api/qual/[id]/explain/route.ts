import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { audioResponse } from "@/server/audioResponse";
import { MAX_AUDIO_BYTES, QualError, ownerExplanation, saveExplanation } from "@/server/qual";
import { readBody } from "@/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The researcher uploads a spoken explanation for a question (saving a draft never needs a trial). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const bytes = await readBody(req, MAX_AUDIO_BYTES);
  if (!bytes) return NextResponse.json({ error: "That recording is too large. Keep explanations under three minutes." }, { status: 400 });
  try {
    const ref = await saveExplanation(getDb(), session.user.id, id, bytes, req.headers.get("content-type") ?? "", Number(req.headers.get("x-seconds") ?? 0));
    return NextResponse.json(ref);
  } catch (err) {
    if (err instanceof QualError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("explain upload", err);
    return NextResponse.json({ error: "We couldn't save that recording. Please try again." }, { status: 500 });
  }
}

/** Plays it back in the builder. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  const file = await ownerExplanation(getDb(), session.user.id, id, new URL(req.url).searchParams.get("k") ?? "").catch(() => null);
  return file ? audioResponse(req, file) : new Response("Not found", { status: 404 });
}
