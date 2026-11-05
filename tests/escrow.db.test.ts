// Runs the escrow service against a real (in-memory) PostgreSQL using the generated migrations.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { EscrowError, escrowBalance, expertAvailable, fundMilestone, refundMilestone, releaseMilestone, settleMilestone } from "@/server/escrow";
import { applyVerifiedTransaction } from "@/server/payments";

let db: DB;
let ids: { client: string; expert: string; order: string; m1: string; m2: string };

beforeEach(async () => {
  const pg = new PGlite();
  const d = drizzle(pg, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;

  const [client] = await d.insert(schema.users).values({ email: "client@example.com", name: "Client" }).returning();
  const [expert] = await d
    .insert(schema.users)
    .values({ email: "expert@example.com", name: "Cosmos", roles: ["CLIENT", "EXPERT"] })
    .returning();
  const [order] = await d
    .insert(schema.orders)
    .values({ clientId: client.id, expertId: expert.id, title: "Regression analysis", totalMinor: 100_000, feeBps: 1500 })
    .returning();
  const [m1, m2] = await d
    .insert(schema.milestones)
    .values([
      { orderId: order.id, position: 1, title: "Analysis plan", amountMinor: 40_000 },
      { orderId: order.id, position: 2, title: "Results", amountMinor: 60_000 },
    ])
    .returning();
  ids = { client: client.id, expert: expert.id, order: order.id, m1: m1.id, m2: m2.id };
});

const fund = (milestoneId: string, amountMinor: number, reference = `ref-${milestoneId}`) =>
  fundMilestone(db, { milestoneId, amountMinor, currency: "GHS", reference });

const status = async (id: string) =>
  (await db.select().from(schema.milestones).where(eq(schema.milestones.id, id)))[0].status;

describe("escrow service (database)", () => {
  it("funds a milestone once and activates the order", async () => {
    expect(await fund(ids.m1, 40_000)).toBe("funded");
    expect(await fund(ids.m1, 40_000)).toBe("already-funded"); // webhook + redirect both arrive
    expect(await escrowBalance(db, ids.m1)).toBe(40_000);
    expect(await status(ids.m1)).toBe("FUNDED");
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, ids.order));
    expect(o.status).toBe("ACTIVE");
  });

  it("refuses a payment of the wrong amount", async () => {
    await expect(fund(ids.m1, 39_999)).rejects.toThrow(EscrowError);
    expect(await escrowBalance(db, ids.m1)).toBe(0);
  });

  it("releases only after delivery, only by the client, net of fee", async () => {
    await fund(ids.m1, 40_000);
    await expect(releaseMilestone(db, { milestoneId: ids.m1, approvedBy: ids.client })).rejects.toThrow(/delivered/);
    await db.update(schema.milestones).set({ status: "DELIVERED" }).where(eq(schema.milestones.id, ids.m1));
    await expect(releaseMilestone(db, { milestoneId: ids.m1, approvedBy: ids.expert })).rejects.toThrow(/client/);

    await releaseMilestone(db, { milestoneId: ids.m1, approvedBy: ids.client });
    expect(await escrowBalance(db, ids.m1)).toBe(0);
    expect(await expertAvailable(db, ids.expert)).toBe(34_000); // 40,000 − 15%
    expect(await status(ids.m1)).toBe("APPROVED");
    await expect(releaseMilestone(db, { milestoneId: ids.m1, approvedBy: ids.client })).rejects.toThrow();
  });

  it("refunds escrow and cannot refund twice", async () => {
    await fund(ids.m2, 60_000);
    expect((await refundMilestone(db, { milestoneId: ids.m2 })).refundedMinor).toBe(60_000);
    expect(await escrowBalance(db, ids.m2)).toBe(0);
    await expect(refundMilestone(db, { milestoneId: ids.m2 })).rejects.toThrow();
  });

  it("settles a dispute partly to each side", async () => {
    await fund(ids.m2, 60_000);
    const r = await settleMilestone(db, { milestoneId: ids.m2, releaseMinor: 20_000 });
    expect(r).toEqual({ releasedMinor: 20_000, refundedMinor: 40_000 });
    expect(await expertAvailable(db, ids.expert)).toBe(17_000);
  });

  it("every ledger movement balances to zero overall", async () => {
    await fund(ids.m1, 40_000);
    await fund(ids.m2, 60_000);
    await db.update(schema.milestones).set({ status: "DELIVERED" }).where(eq(schema.milestones.id, ids.m1));
    await releaseMilestone(db, { milestoneId: ids.m1, approvedBy: ids.client });
    await refundMilestone(db, { milestoneId: ids.m2 });
    const all = await db.select().from(schema.ledgerEntries);
    expect(all.reduce((s, e) => s + e.amountMinor, 0)).toBe(0);
  });

  it("applies a verified Paystack payment to the right milestone, idempotently", async () => {
    const tx = {
      status: "success",
      reference: "ps_123",
      amount: 40_000,
      currency: "GHS",
      metadata: { purpose: "milestone" as const, milestoneId: ids.m1, userId: ids.client },
      customer: { email: "client@example.com" },
    };
    expect(await applyVerifiedTransaction(db, tx)).toBe("funded");
    expect(await applyVerifiedTransaction(db, tx)).toBe("already-funded");
    const events = await db.select().from(schema.paymentEvents);
    expect(events).toHaveLength(1);
    expect(await applyVerifiedTransaction(db, { ...tx, reference: "ps_fail", status: "failed" })).toBe("not-successful");
  });
});
