import { after, NextResponse } from "next/server";
import { getDb } from "@/db";
import { audioResponse } from "@/server/audioResponse";
import { afterSubmit } from "@/server/qualApi";
import { MAX_AUDIO_BYTES, publicExplanation, QualError, clearAudio, resumeResponse, saveAnswer, saveAudio, startResponse, submitResponse } from "@/server/qual";
import { clientIp, hit, readBody } from "@/server/rateLimit";

// per visitor and study link, per hour: generous for a real participant, a wall for scripts
const CAPS: Record<string, number> = { start: 20, audio: 150, answer: 600, "clear-audio": 150, resume: 300, submit: 30 };

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
    const ip = clientIp(req.headers);
    const [mine, all] = await Promise.all([hit(db, `s:${op}:${token}:${ip}`, CAPS[op] ?? 100, 3600), hit(db, `s:link:${token}`, 5000, 3600)]);
    if (!mine || !all) return NextResponse.json({ error: "Too many requests from your connection. Please wait a while and try again." }, { status: 429 });
    if (op === "audio") {
      const bytes = await readBody(req, MAX_AUDIO_BYTES);
      if (!bytes) throw new QualError("That recording is too large. Please keep answers shorter.");
      const r = await saveAudio(db, token, rid, secret, req.headers.get("x-question") ?? "", bytes, req.headers.get("content-type") ?? "", Number(req.headers.get("x-seconds") ?? 0));
      return NextResponse.json({ ok: true, ...r });
    }
    const raw = await readBody(req, 256 * 1024);
    if (!raw) return NextResponse.json({ error: "That answer is too long." }, { status: 413 });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(new TextDecoder().decode(raw) || "{}") as Record<string, unknown>;
    } catch {
      /* treated as empty */
    }
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
        // webhooks, then automatic transcription and translation (a paid feature: only while the researcher has access)
        after(() => afterSubmit(getDb(), done).catch((e) => console.error("after submit", e)));
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
