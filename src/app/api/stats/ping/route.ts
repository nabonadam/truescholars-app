import { ping } from "@/server/stats";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Wakes the engine (it sleeps after a quiet spell on free hosting) and says when it is ready. */
export async function POST() {
  return Response.json({ awake: await ping() });
}
