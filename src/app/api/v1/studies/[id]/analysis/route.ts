import { route } from "@/server/apiHttp";
import { apiAnalysis } from "@/server/qualApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The thematic analysis as it stands: themes, codebook with quotes, the participant matrix and the report. */
export const GET = route<{ id: string }>("read", async ({ db, ctx, params }) => apiAnalysis(db, ctx.user.id, params.id));
