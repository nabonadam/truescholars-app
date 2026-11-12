import { route } from "@/server/apiHttp";
import { ApiError } from "@/server/apiAccess";
import { audioResponse } from "@/server/audioResponse";
import { audioFor } from "@/server/qual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The recording of one answer (supports Range requests). */
export const GET = route<{ rid: string; qid: string }>("read", async ({ db, ctx, req, params }) => {
  const file = await audioFor(db, ctx.user.id, params.rid, params.qid).catch(() => null);
  if (!file) throw new ApiError(404, "not_found", "No recording for that response and question.");
  return audioResponse(req, file, "private, no-store");
});
