import { route } from "@/server/apiHttp";
import { ApiError } from "@/server/apiAccess";
import { apiResponse } from "@/server/qualApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ id: string; rid: string }>("read", async ({ db, ctx, params }) => {
  const r = await apiResponse(db, ctx.user.id, params.rid);
  if (r.study_id !== params.id) throw new ApiError(404, "not_found", "Response not found.");
  return r;
});
