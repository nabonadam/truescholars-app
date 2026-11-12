import { route } from "@/server/apiHttp";
import { setStudyOpen } from "@/server/qual";
import { apiStudy, studyView } from "@/server/qualApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>("write", async ({ db, ctx, params }) => {
  await apiStudy(db, ctx.user.id, params.id);
  await setStudyOpen(db, ctx.user.id, params.id, false);
  return studyView(db, await apiStudy(db, ctx.user.id, params.id), { full: true });
});
