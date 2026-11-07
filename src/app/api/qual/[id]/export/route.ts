import { auth } from "@/auth";
import { getDb } from "@/db";
import { getStudy, listResponses } from "@/server/qual";
import { analysisExport } from "@/server/qualAnalysisExport";
import { audioZipStream, responsesCsv, slug, transcriptsZip } from "@/server/qualExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const download = (body: BodyInit, type: string, name: string) =>
  new Response(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store" } });

/** Downloads never need an active trial: people always keep their data. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  const db = getDb();
  const s = await getStudy(db, session.user.id, id);
  if (!s) return new Response("Not found", { status: 404 });
  const f = new URL(req.url).searchParams.get("f") ?? "csv";
  const name = slug(s.title);
  if (f.startsWith("analysis-")) {
    const out = await analysisExport(db, s, f.slice(9));
    return out ? download(out.body, out.type, `${name}-${out.name}`) : new Response("Nothing to export yet", { status: 404 });
  }
  const rs = await listResponses(db, session.user.id, id);
  if (f === "csv") return download(responsesCsv(s, rs, { all: new URL(req.url).searchParams.get("all") === "1" }), "text/csv; charset=utf-8", `${name}-responses.csv`);
  if (f === "transcripts") return download(new Uint8Array(transcriptsZip(s, rs)), "application/zip", `${name}-transcripts.zip`);
  if (f === "audio") return download(audioZipStream(db, s, rs), "application/zip", `${name}-recordings.zip`);
  return new Response("Unknown format", { status: 400 });
}
