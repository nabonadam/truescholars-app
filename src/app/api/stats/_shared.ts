import { auth } from "@/auth";
import { getDb } from "@/db";
import { getSession, listRuns } from "@/server/stats";

export async function owned(id: string) {
  const s = await auth();
  if (!s?.user) return null;
  const db = getDb();
  const session = await getSession(db, s.user.id, id);
  if (!session) return null;
  return { session, runs: await listRuns(db, id) };
}

export function download(body: BodyInit, type: string, name: string) {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const slug = (t: string) => t.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "analysis";
