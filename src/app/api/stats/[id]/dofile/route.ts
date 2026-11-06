import { doFile } from "@/server/stats";
import { download, owned, slug } from "../../_shared";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await owned(id);
  if (!o) return new Response("Not found", { status: 404 });
  return download(doFile(o.session, o.runs), "text/plain; charset=utf-8", `${slug(o.session.title)}.do`);
}
