import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { claude } from "@/server/qualAnalysis";
import { grantToolAccess } from "@/server/toolAccess";
import { QuotaError, countUnit, metered, usageReport, usageStatus } from "@/server/usage";

let db: DB;
let user: { id: string; roles: string[] };
const admin = { id: "", roles: ["CLIENT", "ADMIN"] };

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "esi@example.com", name: "Esi" }).returning();
  const [a] = await d.insert(schema.users).values({ email: "boss@example.com", name: "Boss", roles: ["CLIENT", "ADMIN"] }).returning();
  user = { id: u.id, roles: u.roles };
  admin.id = a.id;
  process.env.ANTHROPIC_API_KEY = "test";
  // every AI call: 1,000 tokens in, 500 out = $0.002 + $0.005 = 7,000 micro-dollars
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-sonnet-5-5", usage: { input_tokens: 1000, output_tokens: 500 } }))));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

const rows = () => db.select().from(schema.aiUsage);

describe("AI usage", () => {
  it("records what each action used and cost, even when it fails part-way", async () => {
    await metered(db, user, "lit", "lit.read", async () => {
      await claude("s", "u", 100);
      await claude("s", "u", 100);
      countUnit("lit.read", 2);
    });
    await expect(metered(db, user, "lit", "lit.write", async () => { await claude("s", "u", 100); throw new Error("boom"); })).rejects.toThrow("boom");
    const r = await rows();
    expect(r.map((x) => [x.action, x.costMicros, x.inputTokens, x.failed, x.access])).toEqual([["lit.read", 14_000, 2000, false, "trial"], ["lit.write", 7_000, 1000, true, "trial"]]);
    expect(r[0].units).toEqual({ "lit.read": 2 });
  });

  it("stops a trial at its limit, and tells the person why", async () => {
    await metered(db, user, "lit", "lit.read", async () => countUnit("lit.read", 10));
    const s = await usageStatus(db, user, "lit");
    expect(s.units).toEqual([{ kind: "lit.read", used: 10, limit: 10 }]);
    expect(s.blocked).toMatch(/all 10 papers read in your free trial/);
    await expect(metered(db, user, "lit", "lit.read", async () => "never")).rejects.toThrow(QuotaError);
  });

  it("soft limits only bite when the AI is actually called (typed Stata commands keep working)", async () => {
    await metered(db, user, "stats", "stats.ask", async () => countUnit("stats.ai", 20));
    expect(await metered(db, user, "stats", "stats.ask", async () => "ran without AI", { soft: true })).toBe("ran without AI");
    await expect(metered(db, user, "stats", "stats.ask", () => claude("s", "u", 100), { soft: true })).rejects.toThrow(QuotaError);
  });

  it("caps AI spending too, and gives paid plans a monthly allowance that resets", async () => {
    await grantToolAccess(db, "lit", "esi@example.com", 30);
    // last month's heavy use doesn't count this month
    await db.insert(schema.aiUsage).values({ userId: user.id, tool: "lit", action: "lit.read", units: { "lit.read": 150 }, costMicros: 20_000_000, createdAt: new Date(Date.now() - 40 * 86_400_000) });
    let s = await usageStatus(db, user, "lit");
    expect(s.blocked).toBeNull();
    expect(s.units[0]).toMatchObject({ used: 0, limit: 150 });
    // $12 of AI this month reaches the cap
    await db.insert(schema.aiUsage).values({ userId: user.id, tool: "lit", action: "lit.write", units: {}, costMicros: 12_000_000 });
    s = await usageStatus(db, user, "lit");
    expect(s.costUsedPct).toBe(100);
    expect(s.blocked).toMatch(/fair-use limit for AI work this month\. It resets on 1 /);
  });

  it("never limits admins, and reports costs against plan income", async () => {
    await db.insert(schema.aiUsage).values({ userId: user.id, tool: "lit", action: "lit.read", access: "trial", units: { "lit.read": 50 }, costMicros: 5_000_000 });
    expect((await usageStatus(db, admin, "lit")).unlimited).toBe(true);
    await db.insert(schema.paymentEvents).values({ reference: "p1", userId: user.id, purpose: "tool", plan: "lit", months: 1, amountMinor: 189_00, currency: "GHS", status: "success" });
    const now = new Date();
    const r = await usageReport(db, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 86_400_000), 11.7);
    expect(r.costUsd).toBe(5);
    expect(r.revenueUsd).toBeCloseTo((189 * 0.9805) / 11.7, 2);
    expect(r.topUsers[0]).toMatchObject({ email: "esi@example.com", lit: 5, papers: 50 });
    void eq;
  });
});
