import { StatsError, engine } from "@/server/stats";
import { download, owned, slug } from "../../_shared";

export const runtime = "nodejs";

/** The working dataset (after the session's data changes) as .dta or .csv. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await owned(id);
  if (!o) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const fmt = url.searchParams.get("fmt") === "csv" ? "csv" : "dta";
  const original = url.searchParams.get("original") === "1";
  try {
    const bytes = await engine<ArrayBuffer>(`/data/${fmt}`, { datasetId: o.session.datasetId, history: original ? [] : o.session.history }, true);
    const name = original ? `${o.session.fileName.replace(/\.[^.]+$/, "")}_original.${fmt}` : `${slug(o.session.title)}.${fmt}`;
    return download(bytes, fmt === "csv" ? "text/csv" : "application/x-stata-dta", name);
  } catch (err) {
    return new Response(err instanceof StatsError ? err.message : "Download failed", { status: 503 });
  }
}
