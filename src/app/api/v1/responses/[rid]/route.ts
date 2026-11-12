import { route } from "@/server/apiHttp";
import { apiResponse } from "@/server/qualApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ rid: string }>("read", async ({ db, ctx, params }) => apiResponse(db, ctx.user.id, params.rid));
