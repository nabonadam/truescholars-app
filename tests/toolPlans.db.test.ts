import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import type { VerifiedTransaction } from "@/lib/paystack";
import { planPrice } from "@/lib/plans";
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
  it("prices plans with the longer-term discount", () => {
    expect(planPrice("lit", 1)).toBe(100_00);
    expect(planPrice("lit", 3)).toBe(270_00);
    expect(planPrice("all", 3)).toBe(486_00);
  });

  it("switches on every tool in the plan, once, even if confirmed twice", async () => {
    const later = new Date(Date.now() + 10 * DAY); // trial long over by then
    const t = tx("plan_1", "all", 3, planPrice("all", 3));
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
