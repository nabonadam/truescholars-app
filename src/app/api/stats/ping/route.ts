import { auth } from "@/auth";
import { ping } from "@/server/stats";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Wakes the engine (it sleeps after a quiet spell on free hosting) and says when it is ready. */
export async function POST() {
  if (!(await auth())?.user) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json({ awake: await ping() });
}
