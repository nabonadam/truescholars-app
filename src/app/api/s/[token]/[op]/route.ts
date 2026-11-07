import { after, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { qualStudies, users } from "@/db/schema";
import { canUse, peekToolAccess } from "@/server/toolAccess";
import { audioResponse } from "@/server/audioResponse";
import { MAX_AUDIO_BYTES, publicExplanation, QualError, clearAudio, resumeResponse, saveAnswer, saveAudio, startResponse, submitResponse, transcribeResponse, transcriptionOn } from "@/server/qual";
import { QuotaError, metered } from "@/server/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A question's spoken explanation, for respondents (GET /api/s/<token>/explain?q=<questionId>). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; op: string }> }) {
  const { token, op } = await params;
  if (op !== "explain") return new Response("Not found", { status: 404 });
  const file = await publicExplanation(getDb(), token, new URL(req.url).searchParams.get("q") ?? "").catch(() => null);
  return file ? audioResponse(req, file, "public, max-age=600") : new Response("Not found", { status: 404 });
}

/**
 * The respondent's side of a study link. No account: `start` returns a response id and a secret,
 * which the browser keeps and sends with every later call (x-response / x-secret headers).
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string; op: string }> }) {
  const { token, op } = await params;
  const db = getDb();
  const rid = req.headers.get("x-response") ?? "";
  const secret = req.headers.get("x-secret") ?? "";
  try {
    if (op === "audio") {
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > MAX_AUDIO_BYTES) throw new QualError("That recording is too large. Please keep answers shorter.");
      const bytes = new Uint8Array(await req.arrayBuffer());
      const r = await saveAudio(db, token, rid, secret, req.headers.get("x-question") ?? "", bytes, req.headers.get("content-type") ?? "", Number(req.headers.get("x-seconds") ?? 0));
      return NextResponse.json({ ok: true, ...r });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    switch (op) {
      case "start":
        return NextResponse.json(await startResponse(db, token, { name: String(body.name ?? ""), email: String(body.email ?? ""), userAgent: req.headers.get("user-agent") ?? "" }));
      case "resume":
        return NextResponse.json({ answers: await resumeResponse(db, token, rid, secret) });
      case "answer":
        await saveAnswer(db, token, rid, secret, String(body.questionId ?? ""), body.answer as Parameters<typeof saveAnswer>[5]);
        return NextResponse.json({ ok: true });
      case "clear-audio":
        await clearAudio(db, token, rid, secret, String(body.questionId ?? ""));
        return NextResponse.json({ ok: true });
      case "submit": {
        const done = await submitResponse(db, token, rid, secret);
        // Automatic transcription is a paid feature: only while the researcher has access.
        if (transcriptionOn()) after(async () => {
          const [owner] = await getDb().select({ id: users.id, roles: users.roles }).from(qualStudies).innerJoin(users, eq(users.id, qualStudies.ownerId)).where(eq(qualStudies.token, token));
          if (!owner || !canUse((await peekToolAccess(getDb(), "qual", owner)).access as Parameters<typeof canUse>[0])) return;
          // counted against the researcher's transcription allowance; over it, recordings wait for them to transcribe later
          await metered(getDb(), owner, "qual", "qual.autotranscribe", () => transcribeResponse(getDb(), done.responseId)).catch((e) => {
            if (!(e instanceof QuotaError)) console.error("auto-transcribe", e);
          });
        });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } catch (err) {
    if (err instanceof QualError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("respondent", op, err);
    return NextResponse.json({ error: "Something went wrong saving that. Please try again." }, { status: 500 });
  }
}
