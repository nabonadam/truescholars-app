import { after, NextResponse } from "next/server";
import { getDb } from "@/db";
import { MAX_AUDIO_BYTES, QualError, clearAudio, resumeResponse, saveAnswer, saveAudio, startResponse, submitResponse, transcribeResponse, transcriptionOn } from "@/server/qual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        if (transcriptionOn()) after(() => transcribeResponse(getDb(), done.responseId).catch((e) => console.error("auto-transcribe", e)));
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
