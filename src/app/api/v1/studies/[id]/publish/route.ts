import { route } from "@/server/apiHttp";
import { publishStudy } from "@/server/qual";
import { apiStudy, studyView } from "@/server/qualApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>("write", async ({ db, ctx, params }) => {
  await apiStudy(db, ctx.user.id, params.id);
  await publishStudy(db, ctx.user.id, params.id);
  return studyView(db, await apiStudy(db, ctx.user.id, params.id), { full: true });
});
