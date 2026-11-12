import { route, body, json } from "@/server/apiHttp";
import { apiCreateStudy, apiStudies, studyView } from "@/server/qualApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("read", async ({ db, ctx }) => ({ data: await apiStudies(db, ctx.user.id) }));

export const POST = route("write", async ({ db, ctx, req }) => {
  const s = await apiCreateStudy(db, ctx.user.id, await body(req));
  return json(await studyView(db, s, { full: true }), 201);
});
