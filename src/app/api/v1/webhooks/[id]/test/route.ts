import { route } from "@/server/apiHttp";
import { testWebhook } from "@/server/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sends a signed sample delivery (event "webhook.test") and reports what the endpoint answered. */
export const POST = route<{ id: string }>("write", async ({ db, ctx, params }) => testWebhook(db, ctx.user.id, params.id));
