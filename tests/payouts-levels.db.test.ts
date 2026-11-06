import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { expertAvailable, fundMilestone } from "@/server/escrow";
import { creditBalance, expertProfileOf } from "@/server/jobs";
import { computeLevel, evaluateLevel, expertStats, progressTowards, type ExpertStats } from "@/server/levels";
import { listNotifications } from "@/server/notifications";
import { approveDelivery, leaveReview, submitDelivery } from "@/server/orderRoom";
import { createOrderFromService } from "@/server/orders";
import {
  earningsHistory,
  earningsSummary,
  markWithdrawalPaid,
  rejectWithdrawal,
  requestWithdrawal,
  savePayoutMethod,
  validatePayoutMethod,
} from "@/server/payouts";
import { saveService } from "@/server/services";
import { approveApplication, submitApplication } from "@/server/vetting";

let db: DB;
let expert: string, client: string, admin: string, serviceId: string;

/** A full paid-and-approved order worth `priceMinor`, optionally reviewed. */
async function completedOrder(priceMinor = 100_000, rating?: number) {
  const o = await createOrderFromService(db, { clientId: client, serviceId, tier: "BASIC", answers: [], feeBps: 1500 });
  await db.update(schema.milestones).set({ amountMinor: priceMinor }).where(eq(schema.milestones.id, o.milestone.id));
  await fundMilestone(db, { milestoneId: o.milestone.id, amountMinor: priceMinor, currency: "GHS", reference: `ps_${o.milestone.id}` });
  await submitDelivery(db, { milestoneId: o.milestone.id, expertId: expert, note: "Done", fileIds: ["f"] });
  await approveDelivery(db, { milestoneId: o.milestone.id, clientId: client });
  if (rating) await leaveReview(db, { orderId: o.order.id, authorId: client, rating, body: "Great" });
  return o;
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
  serviceId = await saveService(db, expert, { title: "Stata analysis", categoryId: cat.id, description: "d".repeat(130), requirements: [], tiers: [{ name: "BASIC", priceMinor: 100_000, deliveryDays: 5, revisions: 1, includes: [] }] });
});

describe("payout methods", () => {
  it("normalises Ghana mobile numbers and checks bank details", () => {
    expect(validatePayoutMethod({ kind: "momo", provider: "MTN Mobile Money", accountName: "Ama  Owusu", accountNumber: "+233 24 123 4567" })).toEqual({
      kind: "momo",
      provider: "MTN Mobile Money",
      accountName: "Ama Owusu",
      accountNumber: "0241234567",
    });
    expect(() => validatePayoutMethod({ kind: "momo", provider: "MTN Mobile Money", accountName: "Ama", accountNumber: "12345" })).toThrow(/10-digit/);
    expect(() => validatePayoutMethod({ kind: "momo", provider: "Vodafone", accountName: "Ama", accountNumber: "0241234567" })).toThrow(/network/);
    expect(() => validatePayoutMethod({ kind: "bank", provider: "GCB Bank", accountName: "Ama Owusu", accountNumber: "12AB" })).toThrow(/digits/);
  });
});

describe("withdrawals", () => {
  it("sets money aside on request, pays out, and keeps the ledger straight", async () => {
    await completedOrder(100_000); // expert nets GH₵850
    expect(await expertAvailable(db, expert)).toBe(85_000);
    await expect(requestWithdrawal(db, { userId: expert, amountMinor: 50_000 })).rejects.toThrow(/Mobile Money or bank/);
    await savePayoutMethod(db, expert, { kind: "momo", provider: "MTN Mobile Money", accountName: "Ama Owusu", accountNumber: "0241234567" });
    await expect(requestWithdrawal(db, { userId: expert, amountMinor: 1_000 })).rejects.toThrow(/minimum/);
    await expect(requestWithdrawal(db, { userId: expert, amountMinor: 90_000 })).rejects.toThrow(/up to GH₵850/);
    await expect(requestWithdrawal(db, { userId: client, amountMinor: 50_000 })).rejects.toThrow(/Only experts/);

    const w = await requestWithdrawal(db, { userId: expert, amountMinor: 50_000 });
    expect(await expertAvailable(db, expert)).toBe(35_000);
    await expect(requestWithdrawal(db, { userId: expert, amountMinor: 10_000 })).rejects.toThrow(/already have/);
    expect((await listNotifications(db, admin)).some((n) => n.kind === "PAYOUT")).toBe(true);

    let s = await earningsSummary(db, expert);
    expect(s).toMatchObject({ available: 35_000, pendingPayout: 50_000, earned: 85_000, withdrawn: 0, inEscrow: 0 });

    await expect(markWithdrawalPaid(db, { withdrawalId: w.id, adminId: admin, payoutReference: "x" })).rejects.toThrow(/transaction ID/);
    await markWithdrawalPaid(db, { withdrawalId: w.id, adminId: admin, payoutReference: "MTN-889201" });
    await expect(markWithdrawalPaid(db, { withdrawalId: w.id, adminId: admin, payoutReference: "MTN-889201" })).rejects.toThrow(/already/);
    s = await earningsSummary(db, expert);
    expect(s).toMatchObject({ available: 35_000, pendingPayout: 0, withdrawn: 50_000 });
    expect(s.monthly.at(-1)?.totalMinor).toBe(85_000);
    expect((await listNotifications(db, expert)).find((n) => n.kind === "PAYOUT")?.title).toContain("GH₵500.00");

    const history = await earningsHistory(db, expert);
    expect(history.map((h) => [h.label, h.amountMinor])).toEqual([["Withdrawal", -50_000], ["Payment released", 85_000]]);
    expect(history[1].orderTitle).toBe("Stata analysis");

    // Whole platform still balances to zero
    const all = await db.select({ a: schema.ledgerEntries.amountMinor }).from(schema.ledgerEntries);
    expect(all.reduce((s, r) => s + r.a, 0)).toBe(0);
  });

  it("a rejected withdrawal goes back to the balance", async () => {
    await completedOrder(100_000);
    await savePayoutMethod(db, expert, { kind: "bank", provider: "GCB Bank", accountName: "Ama Owusu", accountNumber: "1234567890" });
    const w = await requestWithdrawal(db, { userId: expert, amountMinor: 85_000 });
    expect(await expertAvailable(db, expert)).toBe(0);
    await rejectWithdrawal(db, { withdrawalId: w.id, adminId: admin, note: "The account name doesn't match your profile." });
    expect(await expertAvailable(db, expert)).toBe(85_000);
    expect((await earningsSummary(db, expert)).pendingPayout).toBe(0);
  });
});

describe("seller levels", () => {
  const base: ExpertStats = { orders: 0, earnedMinor: 0, rating: null, reviews: 0, onTime: null, days: 0, lostDisputes: 0 };

  it("needs every requirement for a level", () => {
    expect(computeLevel(base)).toBe("NEW");
    const l1 = { ...base, orders: 3, earnedMinor: 60_000, rating: 4.6, reviews: 2, onTime: 1, days: 20 };
    expect(computeLevel(l1)).toBe("LEVEL_1");
    expect(computeLevel({ ...l1, lostDisputes: 1 })).toBe("NEW");
    expect(computeLevel({ ...l1, rating: 4.4 })).toBe("NEW");
    expect(computeLevel({ ...l1, orders: 12, earnedMinor: 400_000, rating: 4.9, reviews: 8, days: 90, onTime: 0.95 })).toBe("LEVEL_2");
    expect(progressTowards(base, "LEVEL_1").find((c) => c.key === "orders")).toMatchObject({ show: "0 of 3", met: false });
  });

  it("is earned from real orders, celebrated, and raises the credit allowance", async () => {
    await db.update(schema.expertProfiles).set({ createdAt: new Date(Date.now() - 30 * 86_400_000) }).where(eq(schema.expertProfiles.userId, expert));
    await completedOrder(30_000, 5);
    await completedOrder(30_000, 5);
    expect((await expertProfileOf(db, expert))!.level).toBe("NEW");
    await completedOrder(30_000, 4); // third order: GH₵765 earned, 4.7 average, all on time
    const stats = await expertStats(db, expert);
    expect(stats).toMatchObject({ orders: 3, reviews: 3, onTime: 1, lostDisputes: 0 });
    // the level is checked when payment is released (before the 3rd review), so re-check now
    await evaluateLevel(db, expert);
    const p = (await expertProfileOf(db, expert))!;
    expect(p.level).toBe("LEVEL_1");
    expect((await listNotifications(db, expert)).some((n) => n.kind === "LEVEL_UP")).toBe(true);
    await db.update(schema.expertProfiles).set({ creditsMonth: "2000-01", bidCredits: 3 }).where(eq(schema.expertProfiles.id, p.id));
    expect(await creditBalance(db, p.id)).toBe(30);
  });
});
