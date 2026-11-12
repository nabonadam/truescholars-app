import { apiAccessFor } from "@/server/apiAccess";
import { route } from "@/server/apiHttp";
import { usageStatus } from "@/server/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who the key belongs to, its scopes, the plan and this month's Qualitative Studio allowance. */
export const GET = route(null, async ({ db, ctx }) => {
  const [plan, usage] = await Promise.all([apiAccessFor(db, ctx.user), usageStatus(db, ctx.user, "qual")]);
  return {
    user: { id: ctx.user.id, name: ctx.user.name },
    key: { id: ctx.key.id, name: ctx.key.name, scopes: ctx.key.scopes },
    plan: { name: "Qualitative Studio API", active: plan.active, until: plan.until?.toISOString() ?? null },
    usage: usage.unlimited ? { unlimited: true } : { units: usage.units.map((u) => ({ kind: u.kind, used: u.used, limit: u.limit })), resets_at: usage.resetsAt?.toISOString() ?? null },
  };
});
