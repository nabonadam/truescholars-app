import { route, body } from "@/server/apiHttp";
import { deleteStudy } from "@/server/qual";
import { apiStudy, apiUpdateStudy, studyView } from "@/server/qualApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { id: string };

export const GET = route<P>("read", async ({ db, ctx, params }) => studyView(db, await apiStudy(db, ctx.user.id, params.id), { full: true }));

/** Changes the draft. Respondents keep seeing the published version until you publish again. */
export const PATCH = route<P>("write", async ({ db, ctx, req, params }) => studyView(db, await apiUpdateStudy(db, ctx.user.id, params.id, await body(req)), { full: true }));

export const DELETE = route<P>("write", async ({ db, ctx, params }) => {
  await apiStudy(db, ctx.user.id, params.id);
  await deleteStudy(db, ctx.user.id, params.id);
  return { id: params.id, deleted: true };
});
