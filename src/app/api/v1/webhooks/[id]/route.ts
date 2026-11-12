import { route, body } from "@/server/apiHttp";
import { deleteWebhook, listWebhooks, setWebhookActive, webhookView } from "@/server/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { id: string };

/** { active: true | false }: pause a webhook, or switch it back on after it was turned off for failing. */
export const PATCH = route<P>("write", async ({ db, ctx, req, params }) => {
  const b = await body(req);
  await setWebhookActive(db, ctx.user.id, params.id, b.active === true);
  return webhookView((await listWebhooks(db, ctx.user.id)).find((w) => w.id === params.id)!);
});

export const DELETE = route<P>("write", async ({ db, ctx, params }) => {
  await deleteWebhook(db, ctx.user.id, params.id);
  return { id: params.id, deleted: true };
});
