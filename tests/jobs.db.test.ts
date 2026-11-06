import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { fundMilestone } from "@/server/escrow";
import {
  closeJob,
  creditBalance,
  creditsFor,
  declineProposal,
  expertProfileOf,
  hireProposal,
  listJobsForClient,
  listOpenJobs,
  listProposalsForExpert,
  listProposalsForJob,
  MONTHLY_CREDITS,
  nextFundable,
  postJob,
  priceGuides,
  recommendedJobs,
  setShortlisted,
  submitProposal,
  validateJob,
  withdrawProposal,
} from "@/server/jobs";
import { listNotifications } from "@/server/notifications";
import { approveDelivery, submitDelivery } from "@/server/orderRoom";
import { saveService } from "@/server/services";
import { approveApplication, submitApplication } from "@/server/vetting";

let db: DB;
let client: string, ama: string, kofi: string, catId: string, otherCatId: string;

const job = (over: Partial<Parameters<typeof validateJob>[0]> = {}) => ({
  title: "Run logistic regression on DHS data in Stata",
  categoryId: catId,
  description: "I have Ghana DHS 2022 data and need a logistic regression on contraceptive use with weights, plus a short write-up of the results.".padEnd(120, "."),
  skills: ["Stata", "Survey weights"],
  budgetMinMinor: 30_000,
  budgetMaxMinor: 60_000,
  timelineDays: 7,
  level: "masters",
  ...over,
});
const pitch = "I have run weighted DHS models for three theses. I will clean the data, fit the model and explain each result clearly.";
const plan = (...amounts: number[]) => amounts.map((a, i) => ({ title: `Part ${i + 1}`, amountMinor: a, dueInDays: 3 }));

async function makeExpert(email: string, name: string) {
  const [u] = await db.insert(schema.users).values({ email, name }).returning();
  const app = await submitApplication(db, u.id, { qualification: "PhD", fields: ["Statistics"], experienceYears: 5, pitch: "p".repeat(90), cvUrl: "https://x.org/cv" });
  await approveApplication(db, { applicationId: app.id });
  return u.id;
}

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [c] = await d.insert(schema.users).values({ email: "akosua@example.com", name: "Akosua Mensah" }).returning();
  client = c.id;
  ama = await makeExpert("ama@example.com", "Ama Owusu");
  kofi = await makeExpert("kofi@example.com", "Kofi Boateng");
  const cats = await d.select().from(schema.categories).limit(2);
  catId = cats[0].id;
  otherCatId = cats[1].id;
  // Ama sells in this category: she's the "top match" and gets job alerts
  await saveService(db, ama, {
    title: "Stata analysis for your thesis",
    categoryId: catId,
    description: "d".repeat(130),
    requirements: [],
    tiers: [{ name: "BASIC", priceMinor: 40_000, deliveryDays: 5, revisions: 1, includes: [] }],
  });
});

describe("posting jobs", () => {
  it("validates the essentials", () => {
    expect(() => validateJob(job({ title: "Help" }))).toThrow(/title/);
    expect(() => validateJob(job({ description: "short" }))).toThrow(/detail/);
    expect(() => validateJob(job({ budgetMinMinor: 500 }))).toThrow(/minimum budget/);
    expect(() => validateJob(job({ budgetMaxMinor: 10_000 }))).toThrow(/lower/);
    expect(() => validateJob(job({ timelineDays: 5 }))).toThrow(/timeline/);
    expect(validateJob(job({ skills: ["Stata", "stata ", "R"] })).skills).toEqual(["Stata", "R"]);
  });

  it("alerts experts who sell in the category, and lists the job", async () => {
    const j = await postJob(db, client, job());
    expect((await listNotifications(db, ama)).map((n) => n.kind)).toContain("JOB_MATCH");
    expect((await listNotifications(db, kofi)).map((n) => n.kind)).not.toContain("JOB_MATCH");
    const open = await listOpenJobs(db, { q: "regression", viewerUserId: kofi });
    expect(open.map((o) => o.id)).toEqual([j.id]);
    expect(open[0]).toMatchObject({ proposalCount: 0, applied: false, credits: creditsFor(60_000) });
    expect(await listOpenJobs(db, { budget: "2000+" })).toEqual([]);
    expect((await recommendedJobs(db, ama)).map((r) => r.id)).toEqual([j.id]);
  });

  it("price guide needs at least three data points", async () => {
    expect(await priceGuides(db)).toEqual({});
    for (const [p, who] of [[60_000, kofi], [80_000, kofi]] as const) {
      await saveService(db, who, {
        title: `Regression help ${p}`,
        categoryId: catId,
        description: "d".repeat(130),
        requirements: [],
        tiers: [{ name: "BASIC", priceMinor: p, deliveryDays: 5, revisions: 1, includes: [] }],
      });
    }
    expect((await priceGuides(db))[catId]).toEqual({ low: 40_000, median: 60_000, high: 80_000, n: 3 });
  });
});

describe("credits", () => {
  it("cost scales with budget and the allowance tops up monthly", async () => {
    expect([creditsFor(50_000), creditsFor(50_001), creditsFor(200_001)]).toEqual([2, 4, 6]);
    const p = (await expertProfileOf(db, kofi))!;
    await db.update(schema.expertProfiles).set({ bidCredits: 3, creditsMonth: "2026-10" }).where(eq(schema.expertProfiles.id, p.id));
    expect(await creditBalance(db, p.id, new Date("2026-10-20"))).toBe(3);
    expect(await creditBalance(db, p.id, new Date("2026-11-02"))).toBe(MONTHLY_CREDITS);
  });

  it("blocks bids without enough credits", async () => {
    const j = await postJob(db, client, job({ budgetMaxMinor: 300_000 }));
    const p = (await expertProfileOf(db, kofi))!;
    await creditBalance(db, p.id); // settle this month's top-up first
    await db.update(schema.expertProfiles).set({ bidCredits: 5 }).where(eq(schema.expertProfiles.id, p.id));
    await expect(submitProposal(db, { jobId: j.id, expertUserId: kofi, pitch, milestonePlan: plan(50_000) })).rejects.toThrow(/needs 6 credits and you have 5/);
  });
});

describe("proposals and hiring", () => {
  it("runs the whole flow: bid, review, shortlist, hire, pay milestone by milestone", async () => {
    const j = await postJob(db, client, job());
    const { balanceAfter } = await submitProposal(db, { jobId: j.id, expertUserId: ama, pitch, milestonePlan: plan(20_000, 30_000) });
    expect(balanceAfter).toBe(MONTHLY_CREDITS - 4);
    await submitProposal(db, { jobId: j.id, expertUserId: kofi, pitch, milestonePlan: plan(45_000) });
    await expect(submitProposal(db, { jobId: j.id, expertUserId: kofi, pitch, milestonePlan: plan(45_000) })).rejects.toThrow(/already/);
    await expect(submitProposal(db, { jobId: j.id, expertUserId: client, pitch, milestonePlan: plan(45_000) })).rejects.toThrow(/approved experts/);
    expect((await listNotifications(db, client)).filter((n) => n.kind === "NEW_PROPOSAL")).toHaveLength(2);

    expect((await listJobsForClient(db, client))[0]).toMatchObject({ proposals: 2, unseen: 2 });
    const props = await listProposalsForJob(db, j.id, client, { markViewed: true });
    const amaP = props.find((p) => p.expert.userId === ama)!;
    const kofiP = props.find((p) => p.expert.userId === kofi)!;
    expect(amaP).toMatchObject({ topMatch: true, priceMinor: 50_000, timelineDays: 6, isNew: true });
    expect(kofiP.topMatch).toBe(false);
    expect(amaP.score).toBeGreaterThan(kofiP.score);
    expect((await listJobsForClient(db, client))[0].unseen).toBe(0);
    await expect(listProposalsForJob(db, j.id, kofi)).rejects.toThrow(/not found/);

    await setShortlisted(db, amaP.id, client, true);
    expect((await listJobsForClient(db, client))[0].shortlisted).toBe(1);

    const order = await hireProposal(db, { proposalId: amaP.id, clientId: client, feeBps: 1500 });
    expect(order).toMatchObject({ expertId: ama, clientId: client, totalMinor: 50_000, status: "AWAITING_PAYMENT" });
    await expect(hireProposal(db, { proposalId: kofiP.id, clientId: client })).rejects.toThrow(/already hired/);
    expect((await listProposalsForExpert(db, kofi))[0].proposal.status).toBe("DECLINED");
    expect((await listNotifications(db, ama)).map((n) => n.kind)).toContain("HIRED");
    expect((await listNotifications(db, kofi)).map((n) => n.kind)).toContain("PROPOSAL_DECLINED");
    expect((await listOpenJobs(db, {})).length).toBe(0);

    // Milestones are funded one at a time
    let ms = await db.select().from(schema.milestones).where(eq(schema.milestones.orderId, order.id)).orderBy(schema.milestones.position);
    expect(ms.map((m) => [m.title, m.amountMinor])).toEqual([["Part 1", 20_000], ["Part 2", 30_000]]);
    expect(nextFundable(ms)?.position).toBe(1);
    await fundMilestone(db, { milestoneId: ms[0].id, amountMinor: 20_000, currency: "GHS", reference: "ps_a" });
    ms = await db.select().from(schema.milestones).where(eq(schema.milestones.orderId, order.id)).orderBy(schema.milestones.position);
    expect(nextFundable(ms)).toBeNull(); // part 1 in progress
    await submitDelivery(db, { milestoneId: ms[0].id, expertId: ama, note: "Cleaned data and model", fileIds: [] }).catch(() => undefined);
    await db.update(schema.milestones).set({ status: "DELIVERED" }).where(eq(schema.milestones.id, ms[0].id));
    await approveDelivery(db, { milestoneId: ms[0].id, clientId: client });
    ms = await db.select().from(schema.milestones).where(eq(schema.milestones.orderId, order.id)).orderBy(schema.milestones.position);
    expect(nextFundable(ms)?.position).toBe(2);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(o.status).toBe("ACTIVE");
  });

  it("withdrawn proposals can be resubmitted; declined ones notify the expert", async () => {
    const j = await postJob(db, client, job());
    const { proposal } = await submitProposal(db, { jobId: j.id, expertUserId: kofi, pitch, milestonePlan: plan(40_000) });
    await withdrawProposal(db, proposal.id, kofi);
    await expect(withdrawProposal(db, proposal.id, kofi)).rejects.toThrow(/can't be withdrawn/);
    const again = await submitProposal(db, { jobId: j.id, expertUserId: kofi, pitch, milestonePlan: plan(35_000) });
    expect(again.proposal.id).toBe(proposal.id);
    expect(again.proposal.priceMinor).toBe(35_000);
    await declineProposal(db, proposal.id, client);
    expect((await listNotifications(db, kofi)).some((n) => n.kind === "PROPOSAL_DECLINED")).toBe(true);
  });

  it("closing a job refunds everyone's credits", async () => {
    const j = await postJob(db, client, job({ categoryId: otherCatId }));
    await submitProposal(db, { jobId: j.id, expertUserId: kofi, pitch, milestonePlan: plan(40_000) });
    const p = (await expertProfileOf(db, kofi))!;
    expect(p.bidCredits).toBe(MONTHLY_CREDITS - 4);
    await expect(closeJob(db, j.id, kofi)).rejects.toThrow(/not found/);
    await closeJob(db, j.id, client);
    expect((await expertProfileOf(db, kofi))!.bidCredits).toBe(MONTHLY_CREDITS);
    await expect(submitProposal(db, { jobId: j.id, expertUserId: ama, pitch, milestonePlan: plan(40_000) })).rejects.toThrow(/isn't taking/);
  });

  it("milestone plans are checked", async () => {
    const j = await postJob(db, client, job());
    await expect(submitProposal(db, { jobId: j.id, expertUserId: kofi, pitch, milestonePlan: [] })).rejects.toThrow(/at least one/);
    await expect(submitProposal(db, { jobId: j.id, expertUserId: kofi, pitch, milestonePlan: plan(500) })).rejects.toThrow(/minimum is GH₵10/);
    await expect(submitProposal(db, { jobId: j.id, expertUserId: kofi, pitch, milestonePlan: plan(1e3, 1e3, 1e3, 1e3, 1e3, 1e3) })).rejects.toThrow(/at most 5/);
    await expect(submitProposal(db, { jobId: j.id, expertUserId: kofi, pitch: "Hi", milestonePlan: plan(40_000) })).rejects.toThrow(/approach/);
  });
});
