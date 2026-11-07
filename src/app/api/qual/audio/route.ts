import { auth } from "@/auth";
import { getDb } from "@/db";
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
  const size = file.bytes.length;
  const base = { "Content-Type": file.mimeType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.min(start, size - 1);
    end = Math.min(end, size - 1);
    return new Response(file.bytes.slice(start, end + 1), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(file.bytes as BodyInit, { headers: { ...base, "Content-Length": String(size) } });
}
