import { ping } from "@/server/stats";

export const runtime = "nodejs";

/** Called when the workspace opens, so a sleeping engine is awake by the first command. */
export async function POST() {
  await ping();
  return Response.json({ ok: true });
}
