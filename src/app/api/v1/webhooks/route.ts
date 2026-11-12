import { route, body, json } from "@/server/apiHttp";
import { apiStudy } from "@/server/qualApi";
import { createWebhook, listWebhooks, webhookView } from "@/server/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route("read", async ({ db, ctx }) => ({ data: (await listWebhooks(db, ctx.user.id)).map(webhookView) }));

/** { url, events?: ["response.submitted", "response.processed"], study_id? }. The secret is returned once. */
export const POST = route("write", async ({ db, ctx, req }) => {
  const b = await body(req);
  const studyId = typeof b.study_id === "string" && b.study_id ? b.study_id : null;
  if (studyId) await apiStudy(db, ctx.user.id, studyId);
  const { webhook, secret } = await createWebhook(db, ctx.user.id, { url: String(b.url ?? ""), events: Array.isArray(b.events) ? b.events.map(String) : undefined, studyId });
  return json({ ...webhook, secret }, 201);
});
