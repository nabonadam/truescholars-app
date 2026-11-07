/** The US dollar to cedi rate used to charge US$ prices (Paystack in Ghana charges in cedis only). */

import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { fxRates } from "@/db/schema";

const FALLBACK = 11.67; // Bank of Ghana, 6 Nov 2026; used only if no rate has been fetched yet
const HOUR = 3_600_000;
const sane = (r: unknown): r is number => typeof r === "number" && r > 3 && r < 100;

export async function usdToGhs(db: DB): Promise<{ rate: number; updatedAt: Date | null; source: string }> {
  const [row] = await db.select().from(fxRates).where(eq(fxRates.code, "USD"));
  if (row && sane(row.ghsPerUnit)) return { rate: row.ghsPerUnit, updatedAt: row.updatedAt, source: row.source };
  const env = Number(process.env.USD_GHS_RATE);
  return { rate: sane(env) ? env : FALLBACK, updatedAt: null, source: sane(env) ? "USD_GHS_RATE" : "fallback" };
}

/** Fetches today's rate (free, no key) if ours is over 12 hours old. Called by the hourly job. */
export async function refreshUsdRate(db: DB, now = new Date(), get: typeof fetch = fetch) {
  const [row] = await db.select().from(fxRates).where(eq(fxRates.code, "USD"));
  if (row && now.getTime() - row.updatedAt.getTime() < 12 * HOUR) return { rate: row.ghsPerUnit, refreshed: false };
  const res = await get("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Exchange rate service answered ${res.status}`);
  const rate = ((await res.json()) as { rates?: Record<string, number> }).rates?.GHS;
  if (!sane(rate)) throw new Error(`Unexpected USD→GHS rate: ${rate}`);
  await db
    .insert(fxRates)
    .values({ code: "USD", ghsPerUnit: rate, source: "open.er-api.com", updatedAt: now })
    .onConflictDoUpdate({ target: fxRates.code, set: { ghsPerUnit: rate, source: "open.er-api.com", updatedAt: now } });
  return { rate, refreshed: true };
}
