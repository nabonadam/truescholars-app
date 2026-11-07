import { auth } from "@/auth";
import { getDb } from "@/db";
import { audioResponse } from "@/server/audioResponse";
import { audioFor } from "@/server/qual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A recording, for the researcher who owns the study. Supports Range so players can seek. */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response("Sign in required", { status: 401 });
  const u = new URL(req.url);
  const file = await audioFor(getDb(), session.user.id, u.searchParams.get("r") ?? "", u.searchParams.get("q") ?? "").catch(() => null);
  if (!file) return new Response("Not found", { status: 404 });
  return audioResponse(req, file);
}
