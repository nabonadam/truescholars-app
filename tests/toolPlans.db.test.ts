import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import type { VerifiedTransaction } from "@/lib/paystack";
import { chargeGhsMinor, currencyForCountry, planPrice } from "@/lib/plans";
import { refreshUsdRate, usdToGhs } from "@/server/fx";
import { applyVerifiedTransaction } from "@/server/payments";
import { accessFor } from "@/server/statsAccess";
import { toolAccessFor } from "@/server/toolAccess";

let db: DB;
let user: { id: string; roles: string[] };

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "efua@example.com", name: "Efua" }).returning();
  user = { id: u.id, roles: u.roles };
});

const tx = (reference: string, plan: string, months: number, amount: number): VerifiedTransaction => ({ status: "success", reference, amount, currency: "GHS", metadata: { purpose: "tool", plan, months, userId: user.id }, customer: { email: "efua@example.com" } });
const DAY = 86_400_000;

describe("paying for the AI tools", () => {
  it("prices plans in both lists, with the longer-term discounts", () => {
    expect(planPrice("lit", 1, "GHS")).toBe(189);
    expect(planPrice("lit", 3, "GHS")).toBe(510); // 567 less 10%
    expect(planPrice("all", 12, "GHS")).toBe(3411); // 4548 less 25%
    expect(planPrice("lit", 1, "USD")).toBe(24);
    expect(planPrice("all", 12, "USD")).toBe(405);
    expect(chargeGhsMinor(24, "USD", 11.67)).toBe(281_00); // rounded up to a whole cedi
    expect(chargeGhsMinor(189, "GHS", 11.67)).toBe(189_00);
    expect(currencyForCountry("Ghana")).toBe("GHS");
    expect(currencyForCountry(" nigeria ")).toBe("GHS");
    expect(currencyForCountry("United States")).toBe("USD");
    expect(currencyForCountry("US")).toBe("USD");
    expect(currencyForCountry("")).toBeNull();
  });

  it("keeps a daily US$ rate, with a fallback before the first fetch", async () => {
    expect((await usdToGhs(db)).source).toBe("fallback");
    const get = (async () => new Response(JSON.stringify({ rates: { GHS: 11.9 } }))) as unknown as typeof fetch;
    expect(await refreshUsdRate(db, new Date(), get)).toEqual({ rate: 11.9, refreshed: true });
    expect(await refreshUsdRate(db, new Date(), get)).toEqual({ rate: 11.9, refreshed: false }); // not again within 12 hours
    expect((await usdToGhs(db)).rate).toBe(11.9);
    const bad = (async () => new Response(JSON.stringify({ rates: { GHS: 0.01 } }))) as unknown as typeof fetch;
    await expect(refreshUsdRate(db, new Date(Date.now() + 13 * 3_600_000), bad)).rejects.toThrow(/Unexpected/);
  });

  it("accepts a US$ plan charged in cedis at checkout's rate", async () => {
    const charged = chargeGhsMinor(planPrice("lit", 1, "USD"), "USD", 11.67);
    await db.insert(schema.paymentEvents).values({ reference: "plan_usd", userId: user.id, purpose: "tool", plan: "lit", months: 1, amountMinor: charged, currency: "GHS", status: "initialized" });
    expect(await applyVerifiedTransaction(db, tx("plan_usd", "lit", 1, charged - 100))).toBe("invalid"); // a cedi short
    await db.update(schema.paymentEvents).set({ appliedAt: null }).where(eq(schema.paymentEvents.reference, "plan_usd"));
    expect(await applyVerifiedTransaction(db, tx("plan_usd", "lit", 1, charged))).toBe("access-on");
  });

  it("switches on every tool in the plan, once, even if confirmed twice", async () => {
    const later = new Date(Date.now() + 10 * DAY); // trial long over by then
    const t = tx("plan_1", "all", 3, planPrice("all", 3, "GHS") * 100);
    expect(await applyVerifiedTransaction(db, t)).toBe("access-on");
    expect(await applyVerifiedTransaction(db, t)).toBe("access-on"); // webhook + return page
    for (const tool of ["qual", "lit"] as const) {
      const a = await toolAccessFor(db, tool, user, later);
      expect(a.kind).toBe("granted");
      const days = ((a as { endsAt: Date }).endsAt.getTime() - Date.now()) / DAY;
      expect(Math.round(days)).toBe(92); // 2-day trial + 90 days, applied once
    }
    expect((await accessFor(db, user, later)).kind).toBe("granted");
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id));
    expect(notes.map((n) => n.title)).toEqual(["Payment received: All three tools is on"]);
  });

  it("refuses a payment smaller than the plan's price", async () => {
    await toolAccessFor(db, "lit", user); // trial starts today
    expect(await applyVerifiedTransaction(db, tx("plan_2", "lit", 1, 10_00))).toBe("invalid");
    expect((await toolAccessFor(db, "lit", user, new Date(Date.now() + 10 * DAY))).kind).toBe("ended");
  });
});
