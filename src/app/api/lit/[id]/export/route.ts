import { auth } from "@/auth";
import { getDb } from "@/db";
import { getReview } from "@/server/lit";
import { litExport } from "@/server/litExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slug = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 50) || "review";

/** Downloads never need an active trial: people always keep their work. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  const db = getDb();
  const r = await getReview(db, session.user.id, id);
  if (!r) return new Response("Not found", { status: 404 });
  const u = new URL(req.url);
  const f = u.searchParams.get("f") ?? "spreadsheet";
  if (r.role === "expert" && f !== "spreadsheet") return new Response("Not found", { status: 404 });
  const out = await litExport(db, r, f, u.searchParams.get("style"));
  if (!out) return new Response("Nothing to export yet", { status: 404 });
  return new Response(out.body, { headers: { "Content-Type": out.type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${slug(r.title)}-${out.name}`)}`, "Cache-Control": "private, no-store" } });
}
