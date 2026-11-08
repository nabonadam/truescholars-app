import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { getDb } from "@/db";
import { qualAudio } from "@/db/schema";
import { requireUser } from "@/server/guards";
import { checkStorage, moveToR2 } from "@/server/qualStorage";
import { emailConfigured } from "@/lib/mailer";
import { isTestMode, paystackConfigured } from "@/lib/paystack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Admin: is file storage working? ?move=1 also moves a batch of older files into R2 now. */
export async function GET(req: Request) {
  await requireUser("ADMIN");
  const db = getDb();
  const check = await checkStorage();
  const moved = check.ok && check.storage === "r2" && new URL(req.url).searchParams.get("move") ? await moveToR2(db, 40) : null;
  const [{ n }] = await db.select({ n: count() }).from(qualAudio);
  // which services are switched on (never the keys themselves)
  const services = {
    email: emailConfigured(),
    paystack: paystackConfigured() ? (isTestMode() ? "test" : "live") : "off",
    ai: !!process.env.ANTHROPIC_API_KEY,
    transcription: !!process.env.DEEPGRAM_API_KEY,
    hourlyJob: !!process.env.CRON_SECRET,
    googleSignIn: !!process.env.AUTH_GOOGLE_ID,
  };
  return NextResponse.json({ ...check, inDatabase: Number(n), moved, services, statsEngine: await engineProbe() });
}

/** One quick look at the statistics engine: its /health reply and how the host routed it (never the address). */
async function engineProbe() {
  const base = process.env.STATS_URL?.replace(/\/$/, "");
  if (!base) return { configured: false };
  const t0 = Date.now();
  try {
    const r = await fetch(base + "/health", { signal: AbortSignal.timeout(20_000), cache: "no-store" });
    const body = (await r.text()).replace(/\s+/g, " ").slice(0, 300);
    return { configured: true, host: new URL(base).host.replace(/^[^.]+/, "…"), status: r.status, ms: Date.now() - t0, routing: r.headers.get("x-render-routing"), body };
  } catch (err) {
    return { configured: true, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), ms: Date.now() - t0 };
  }
}
