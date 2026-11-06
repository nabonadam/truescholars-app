import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { acceptOffer, adminResolve, cancelDispute, getDispute, listDisputes, makeOffer, openDispute } from "@/server/disputes";
import { escrowBalance, expertAvailable, fundMilestone } from "@/server/escrow";
import { listNotifications } from "@/server/notifications";
import { approveDelivery, requestRevision, submitDelivery } from "@/server/orderRoom";
import { createOrderFromService } from "@/server/orders";
import { saveService } from "@/server/services";
import { approveApplication, submitApplication } from "@/server/vetting";

let db: DB;
let expert: string, client: string, admin: string, orderId: string, milestoneId: string;
const details = "The analysis doesn't use the survey weights we agreed on, and two of the tables are missing.";

async function order() {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  const [m] = await db.select().from(schema.milestones).where(eq(schema.milestones.id, milestoneId));
  return { o, m };
}

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [e] = await d.insert(schema.users).values({ email: "ama@example.com", name: "Ama Owusu" }).returning();
  const [c] = await d.insert(schema.users).values({ email: "akosua@example.com", name: "Akosua Mensah" }).returning();
  const [a] = await d.insert(schema.users).values({ email: "admin@example.com", name: "Admin", roles: ["CLIENT", "ADMIN"] }).returning();
  expert = e.id;
  client = c.id;
  admin = a.id;
  const app = await submitApplication(db, expert, { qualification: "PhD", fields: ["Statistics"], experienceYears: 4, pitch: "p".repeat(90), cvUrl: "https://x.org/cv" });
  await approveApplication(db, { applicationId: app.id });
  const [cat] = await d.select().from(schema.categories).limit(1);
  const serviceId = await saveService(db, expert, { title: "Stata analysis", categoryId: cat.id, description: "d".repeat(130), requirements: [], tiers: [{ name: "BASIC", priceMinor: 100_000, deliveryDays: 5, revisions: 1, includes: [] }] });
  const created = await createOrderFromService(db, { clientId: client, serviceId, tier: "BASIC", answers: [], feeBps: 1500 });
  orderId = created.order.id;
  milestoneId = created.milestone.id;
  await fundMilestone(db, { milestoneId, amountMinor: 100_000, currency: "GHS", reference: "ps_1" });
  await submitDelivery(db, { milestoneId, expertId: expert, note: "Tables and do-file", fileIds: ["f1"] });
});

describe("opening a dispute", () => {
  it("freezes the milestone and tells the other side and the admins", async () => {
    await expect(openDispute(db, { milestoneId, userId: client, reason: "QUALITY", details: "bad" })).rejects.toThrow(/30 characters/);
    await expect(openDispute(db, { milestoneId, userId: client, reason: "NOPE", details })).rejects.toThrow(/what went wrong/);
    await expect(openDispute(db, { milestoneId, userId: admin, reason: "QUALITY", details })).rejects.toThrow(/not part/);

    const d = await openDispute(db, { milestoneId, userId: client, reason: "QUALITY", details });
    const { o, m } = await order();
    expect(o.status).toBe("DISPUTED");
    expect(m.autoApproveAt).toBeNull();
    await expect(openDispute(db, { milestoneId, userId: expert, reason: "OTHER", details })).rejects.toThrow(/already/);

    // Nothing can move the money while it's open
    await expect(approveDelivery(db, { milestoneId, clientId: client })).rejects.toThrow(/dispute/);
    await expect(requestRevision(db, { milestoneId, clientId: client, reason: "fix" })).rejects.toThrow(/dispute/);

    expect((await listNotifications(db, expert)).some((n) => n.kind === "DISPUTE")).toBe(true);
    expect((await listNotifications(db, admin)).some((n) => n.kind === "DISPUTE")).toBe(true);
    expect((await listDisputes(db, "open")).map((x) => x.dispute.id)).toEqual([d.id]);
    expect(await getDispute(db, d.id, { id: "stranger", roles: ["CLIENT"] })).toBeNull();
    expect((await getDispute(db, d.id, { id: admin, roles: ["ADMIN"] }))?.role).toBe("admin");
  });

  it("can't be opened before the money is in escrow", async () => {
    const [cat] = await db.select().from(schema.categories).limit(1);
    const serviceId = await saveService(db, expert, { title: "Second", categoryId: cat.id, description: "d".repeat(130), requirements: [], tiers: [{ name: "BASIC", priceMinor: 5_000, deliveryDays: 5, revisions: 1, includes: [] }] });
    const unpaid = await createOrderFromService(db, { clientId: client, serviceId, tier: "BASIC", answers: [], feeBps: 1500 });
    await expect(openDispute(db, { milestoneId: unpaid.milestone.id, userId: client, reason: "LATE", details })).rejects.toThrow(/held in escrow/);
  });
});

describe("settling", () => {
  it("by agreement: a split offer accepted by the other side", async () => {
    const d = await openDispute(db, { milestoneId, userId: client, reason: "QUALITY", details });
    await makeOffer(db, { disputeId: d.id, userId: expert, releaseMinor: 60_000 });
    await expect(acceptOffer(db, { disputeId: d.id, userId: expert })).rejects.toThrow(/your own offer/);
    await acceptOffer(db, { disputeId: d.id, userId: client });

    const { o, m } = await order();
    expect(m.status).toBe("APPROVED");
    expect(o.status).toBe("COMPLETED");
    expect(await escrowBalance(db, milestoneId)).toBe(0);
    expect(await expertAvailable(db, expert)).toBe(60_000 - 9_000); // 15% fee on the released part only
    const [row] = await db.select().from(schema.disputes).where(eq(schema.disputes.id, d.id));
    expect(row).toMatchObject({ status: "RESOLVED_PARTIAL", releasedMinor: 60_000, refundedMinor: 40_000 });
    await expect(makeOffer(db, { disputeId: d.id, userId: client, releaseMinor: 0 })).rejects.toThrow(/closed/);
  });

  it("by our team: full refund", async () => {
    const d = await openDispute(db, { milestoneId, userId: client, reason: "NOT_DELIVERED", details });
    await expect(adminResolve(db, { disputeId: d.id, adminId: admin, releaseMinor: 0, decision: "short" })).rejects.toThrow(/20 characters/);
    await expect(adminResolve(db, { disputeId: d.id, adminId: admin, releaseMinor: 200_000, decision: "The delivery did not match the brief at all." })).rejects.toThrow(/between/);
    await adminResolve(db, { disputeId: d.id, adminId: admin, releaseMinor: 0, decision: "The delivery did not match the brief at all." });
    const { o, m } = await order();
    expect(m.status).toBe("REFUNDED");
    expect(o.status).toBe("CANCELLED");
    expect(await expertAvailable(db, expert)).toBe(0);
    const [row] = await db.select().from(schema.disputes).where(eq(schema.disputes.id, d.id));
    expect(row.status).toBe("RESOLVED_REFUND");
  });

  it("withdrawn by the opener: the order carries on and auto-approval restarts", async () => {
    const d = await openDispute(db, { milestoneId, userId: client, reason: "SCOPE", details });
    await expect(cancelDispute(db, { disputeId: d.id, userId: expert })).rejects.toThrow(/Only the person/);
    await cancelDispute(db, { disputeId: d.id, userId: client });
    const { o, m } = await order();
    expect(o.status).toBe("DELIVERED");
    expect(m.autoApproveAt).not.toBeNull();
    await approveDelivery(db, { milestoneId, clientId: client });
    expect((await order()).o.status).toBe("COMPLETED");
  });
});
