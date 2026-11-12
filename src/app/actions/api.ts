"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ApiError, createApiKey, grantApiAccess, revokeApiKey } from "@/server/apiAccess";
import { requireUser } from "@/server/guards";
import { getStudy } from "@/server/qual";
import { createWebhook, deleteWebhook, setWebhookActive, testWebhook } from "@/server/webhooks";
import { grantToolAccess } from "@/server/toolAccess";
import { limit, RateLimitError } from "@/server/rateLimit";

export type ApiState = { error?: string; ok?: string; secret?: string; at?: number };

const known = (err: unknown): ApiState => {
  if (err instanceof ApiError || err instanceof RateLimitError) return { error: err.message, at: Date.now() };
  throw err;
};
const done = (s: ApiState): ApiState => {
  revalidatePath("/settings/api");
  return { ...s, at: Date.now() };
};

export async function createKeyAction(name: string, scopes: string[]): Promise<ApiState> {
  try {
    const user = await requireUser();
    await limit(getDb(), `apikey:${user.id}`, 20, 3600);
    const { key } = await createApiKey(getDb(), user, { name, scopes });
    return done({ ok: "Key created. Copy it now: it won't be shown again.", secret: key });
  } catch (err) {
    return known(err);
  }
}

export async function revokeKeyAction(id: string): Promise<ApiState> {
  try {
    const user = await requireUser();
    await revokeApiKey(getDb(), user.id, id);
    return done({ ok: "Key revoked. Apps using it will stop working straight away." });
  } catch (err) {
    return known(err);
  }
}

export async function createWebhookAction(url: string, events: string[], studyId: string): Promise<ApiState> {
  try {
    const user = await requireUser();
    await limit(getDb(), `webhook:${user.id}`, 30, 3600);
    if (studyId && !(await getStudy(getDb(), user.id, studyId))) throw new ApiError(404, "not_found", "Study not found.");
    const { secret } = await createWebhook(getDb(), user.id, { url, events, studyId: studyId || null });
    return done({ ok: "Webhook added. Copy its signing secret now: it won't be shown again.", secret });
  } catch (err) {
    return known(err);
  }
}

export async function deleteWebhookAction(id: string): Promise<ApiState> {
  try {
    const user = await requireUser();
    await deleteWebhook(getDb(), user.id, id);
    return done({ ok: "Webhook deleted." });
  } catch (err) {
    return known(err);
  }
}

export async function toggleWebhookAction(id: string, active: boolean): Promise<ApiState> {
  try {
    const user = await requireUser();
    await setWebhookActive(getDb(), user.id, id, active);
    return done({ ok: active ? "Webhook switched on." : "Webhook paused." });
  } catch (err) {
    return known(err);
  }
}

export async function testWebhookAction(id: string): Promise<ApiState> {
  try {
    const user = await requireUser();
    await limit(getDb(), `webhooktest:${user.id}`, 30, 3600);
    const r = await testWebhook(getDb(), user.id, id);
    return done(r.delivered ? { ok: `Test delivered: your endpoint answered ${r.status}.` } : { error: `Test failed: ${r.status ?? "no answer"}. Check the address and that it answers with a 2xx status.` });
  } catch (err) {
    return known(err);
  }
}

/** Admin: switch on the API plan for an account (for invoiced organisations and testing). */
export async function grantApiAction(email: string, days: number, note: string): Promise<ApiState> {
  try {
    await requireUser("ADMIN");
    const db = getDb();
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase()));
    if (!u) return { error: "No account with that email.", at: Date.now() };
    if (!(days > 0 && days <= 3650)) return { error: "Choose between 1 and 3650 days.", at: Date.now() };
    const { until } = await grantApiAccess(db, u.id, days, note || "granted by admin");
    await grantToolAccess(db, "qual", email.trim().toLowerCase(), days, note || "with API plan", new Date(), { quiet: true });
    revalidatePath("/admin/api");
    return { ok: `API access on until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.`, at: Date.now() };
  } catch (err) {
    return known(err);
  }
}
