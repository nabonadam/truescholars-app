import { StatsError, engine, imagesFor, tablesFor } from "@/server/stats";
import { download, owned, slug } from "../../_shared";

export const runtime = "nodejs";

/** APA tables to Word (.docx) or Excel (.xlsx): the whole session, or one run (?run=id). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await owned(id);
  if (!o) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const fmt = url.searchParams.get("fmt") === "xlsx" ? "xlsx" : "docx";
  const only = url.searchParams.get("run");
  const runs = only ? o.runs.filter((r) => r.id === only) : o.runs;
  const tables = tablesFor(runs);
  const images = fmt === "docx" ? imagesFor(runs) : [];
  if (!tables.length && !images.length) return new Response("No tables or graphs to export yet", { status: 400 });
  const logs = runs.flatMap((r) => r.results.filter((x) => x.ok && x.log).map((x) => [x.command, x.log]));
  try {
    const bytes = await engine<ArrayBuffer>(`/export/${fmt}`, { title: o.session.title, tables, images, logs }, true);
    const type = fmt === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return download(bytes, type, `${slug(o.session.title)}_tables.${fmt}`);
  } catch (err) {
    return new Response(err instanceof StatsError ? err.message : "Export failed", { status: 503 });
  }
}
