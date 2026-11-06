/**
 * Jobs and bidding (Upwork-style): clients post jobs, approved experts send proposals that cost
 * bid credits, clients shortlist, compare and hire. Hiring turns the proposal's milestone plan into
 * an order that the client funds milestone by milestone through escrow.
 */

import { and, avg, count, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  categories,
  expertProfiles,
  jobs,
  milestones,
  orders,
  proposals,
  reviews,
  services,
  serviceTiers,
  threadMembers,
  threads,
  users,
  type MilestonePlanItem,
} from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { checkUpload, saveUploads } from "./files";
import { notify } from "./notifications";
import { platformFeeBps } from "./orders";

export class JobError extends Error {}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const DAY = 86_400_000;
export const MONTHLY_CREDITS = 20;
export const MIN_BUDGET_MINOR = 2_000; // GH₵20
export const MAX_BUDGET_MINOR = 10_000_000; // GH₵100,000
export const MIN_MILESTONE_MINOR = 1_000; // GH₵10
export const MAX_MILESTONES = 5;

export const LEVELS = { any: "Any level", masters: "Master's or above", phd: "PhD holders" } as const;
export type Level = keyof typeof LEVELS;
export const TIMELINES: { days: number | null; label: string }[] = [
  { days: 3, label: "Within 3 days" },
  { days: 7, label: "Within a week" },
  { days: 14, label: "Within 2 weeks" },
  { days: 30, label: "Within a month" },
  { days: null, label: "Flexible" },
];

/** Credits a proposal costs: bigger jobs cost more, so experts bid where they're a real fit. */
export function creditsFor(budgetMaxMinor: number) {
  if (budgetMaxMinor <= 50_000) return 2; // up to GH₵500
  if (budgetMaxMinor <= 200_000) return 4; // up to GH₵2,000
  return 6;
}

export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
export const nextRefill = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

// ───────────── Posting ─────────────

export type JobInput = {
  title: string;
  categoryId: string;
  description: string;
  skills: string[];
  budgetMinMinor: number;
  budgetMaxMinor: number;
  timelineDays: number | null;
  level: string;
};

export function validateJob(input: JobInput) {
  const title = input.title.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (title.length < 10) throw new JobError("Give the job a clear title (at least 10 characters).");
  if (title.length > 100) throw new JobError("Keep the title under 100 characters.");
  if (!input.categoryId) throw new JobError("Choose a category.");
  if (description.length < 80) throw new JobError("Describe the job in a bit more detail (at least 80 characters) so experts can quote accurately.");
  if (description.length > 6000) throw new JobError("The description is limited to 6,000 characters.");
  const seen = new Set<string>();
  const skills = input.skills
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length >= 1 && s.length <= 30 && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
  if (skills.length > 8) throw new JobError("Add up to 8 skills.");
  const { budgetMinMinor: min, budgetMaxMinor: max } = input;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) throw new JobError("Enter your budget in cedis.");
  if (min < MIN_BUDGET_MINOR) throw new JobError("The minimum budget is GH₵20.");
  if (max < min) throw new JobError("The top of your budget can't be lower than the bottom.");
  if (max > MAX_BUDGET_MINOR) throw new JobError("For budgets above GH₵100,000, please contact us.");
  if (input.timelineDays !== null && !TIMELINES.some((t) => t.days === input.timelineDays)) throw new JobError("Choose a timeline.");
  if (!(input.level in LEVELS)) throw new JobError("Choose the expertise level you need.");
  return { title, description, skills, categoryId: input.categoryId, budgetMinMinor: min, budgetMaxMinor: max, timelineDays: input.timelineDays, level: input.level as Level };
}

export async function postJob(db: DB, clientId: string, input: JobInput, uploads: File[] = []) {
  const v = validateJob(input);
  uploads.filter((f) => f.size > 0).forEach((f) => checkUpload(f.name, f.size)); // fail before creating anything
  const [cat] = await db.select().from(categories).where(eq(categories.id, v.categoryId));
  if (!cat) throw new JobError("Choose a category.");

  const [job] = await db
    .insert(jobs)
    .values({ ...v, clientId, deadline: v.timelineDays ? new Date(Date.now() + v.timelineDays * DAY) : null })
    .returning();
  const fileIds = await saveUploads(db, { jobId: job.id, ownerId: clientId, uploads });
  if (fileIds.length) await db.update(jobs).set({ attachments: fileIds }).where(eq(jobs.id, job.id));

  // Tell experts who sell in this category; they're the likeliest good fits.
  const fits = await db
    .selectDistinct({ userId: expertProfiles.userId })
    .from(services)
    .innerJoin(expertProfiles, eq(expertProfiles.id, services.expertId))
    .where(and(eq(services.categoryId, cat.id), eq(services.status, "ACTIVE"), ne(expertProfiles.userId, clientId)))
    .limit(50);
  await Promise.all(
    fits.map((f) =>
      notify(db, {
        userId: f.userId,
        kind: "JOB_MATCH",
        title: `New job in ${cat.name}: ${job.title}`,
        body: `Budget ${budgetLabel(job)}. Be one of the first to send a proposal.`,
        link: `/jobs/${job.id}`,
      }),
    ),
  );
  return job;
}

export function budgetLabel(j: { budgetMinMinor: number; budgetMaxMinor: number; currency: string }) {
  return j.budgetMinMinor === j.budgetMaxMinor
    ? formatMoney(j.budgetMinMinor, j.currency)
    : `${formatMoney(j.budgetMinMinor, j.currency).replace(/\.00$/, "")}–${formatMoney(j.budgetMaxMinor, j.currency).replace(/^GH₵/, "").replace(/\.00$/, "")}`;
}

/** What experts on the platform actually charge, per category (from live services and accepted proposals). */
export async function priceGuides(db: DB): Promise<Record<string, { low: number; median: number; high: number; n: number }>> {
  const fromServices = await db
    .select({ categoryId: services.categoryId, price: serviceTiers.priceMinor })
    .from(serviceTiers)
    .innerJoin(services, eq(services.id, serviceTiers.serviceId))
    .where(eq(services.status, "ACTIVE"));
  const fromHires = await db
    .select({ categoryId: jobs.categoryId, price: proposals.priceMinor })
    .from(proposals)
    .innerJoin(jobs, eq(jobs.id, proposals.jobId))
    .where(eq(proposals.status, "ACCEPTED"));
  const by = new Map<string, number[]>();
  for (const r of [...fromServices, ...fromHires]) by.set(r.categoryId, [...(by.get(r.categoryId) ?? []), r.price]);
  const at = (xs: number[], i: number) => xs[Math.min(xs.length - 1, Math.max(0, i))];
  const out: Record<string, { low: number; median: number; high: number; n: number }> = {};
  for (const [id, xs] of by) {
    if (xs.length < 3) continue;
    xs.sort((a, b) => a - b);
    out[id] = { low: at(xs, Math.floor(0.25 * (xs.length - 1))), median: at(xs, Math.round(0.5 * (xs.length - 1))), high: at(xs, Math.ceil(0.75 * (xs.length - 1))), n: xs.length };
  }
  return out;
}

// ───────────── Credits ─────────────

/** An expert's credit balance, topping up the free monthly allowance the first time it's read each month. */
export async function creditBalance(db: DB | Tx, expertProfileId: string, now = new Date()) {
  const [p] = await db.select({ bal: expertProfiles.bidCredits, month: expertProfiles.creditsMonth }).from(expertProfiles).where(eq(expertProfiles.id, expertProfileId));
  if (!p) throw new JobError("Expert profile not found");
  const key = monthKey(now);
  if (p.month === key) return p.bal;
  const bal = Math.max(p.bal, MONTHLY_CREDITS);
  await db.update(expertProfiles).set({ bidCredits: bal, creditsMonth: key }).where(eq(expertProfiles.id, expertProfileId));
  return bal;
}

export async function expertProfileOf(db: DB | Tx, userId: string) {
  const [p] = await db.select().from(expertProfiles).where(eq(expertProfiles.userId, userId));
  return p ?? null;
}

// ───────────── Browsing ─────────────

export type BudgetFilter = "" | "u500" | "500-2000" | "2000+";
export type JobSort = "newest" | "budget" | "fewest";

export async function listOpenJobs(db: DB, p: { q?: string; category?: string; budget?: BudgetFilter; sort?: JobSort; viewerUserId?: string; limit?: number }) {
  const conds = [eq(jobs.status, "OPEN")];
  if (p.q) {
    const like = `%${p.q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(jobs.title, like), ilike(jobs.description, like), sql`array_to_string(${jobs.skills}, ' ') ilike ${like}`)!);
  }
  if (p.category) conds.push(eq(categories.slug, p.category));
  if (p.budget === "u500") conds.push(sql`${jobs.budgetMaxMinor} <= 50000`);
  if (p.budget === "500-2000") conds.push(sql`${jobs.budgetMaxMinor} > 50000 and ${jobs.budgetMinMinor} <= 200000`);
  if (p.budget === "2000+") conds.push(sql`${jobs.budgetMaxMinor} > 200000`);

  const rows = await db
    .select({ job: jobs, category: categories.name, categorySlug: categories.slug, clientName: users.name })
    .from(jobs)
    .innerJoin(categories, eq(categories.id, jobs.categoryId))
    .innerJoin(users, eq(users.id, jobs.clientId))
    .where(and(...conds))
    .orderBy(p.sort === "budget" ? desc(jobs.budgetMaxMinor) : desc(jobs.createdAt))
    .limit(p.limit ?? 60);
  const decorated = await decorateJobs(db, rows, p.viewerUserId);
  return p.sort === "fewest" ? decorated.sort((a, b) => a.proposalCount - b.proposalCount) : decorated;
}

type JobRow = { job: typeof jobs.$inferSelect; category: string; categorySlug: string; clientName: string | null };

async function decorateJobs(db: DB, rows: JobRow[], viewerUserId?: string) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.job.id);
  const clientIds = [...new Set(rows.map((r) => r.job.clientId))];
  const [counts, hires, mine] = await Promise.all([
    db.select({ jobId: proposals.jobId, n: count() }).from(proposals).where(and(inArray(proposals.jobId, ids), ne(proposals.status, "WITHDRAWN"))).groupBy(proposals.jobId),
    db.select({ clientId: orders.clientId, n: count() }).from(orders).where(and(inArray(orders.clientId, clientIds), ne(orders.status, "AWAITING_PAYMENT"))).groupBy(orders.clientId),
    viewerUserId
      ? db
          .select({ jobId: proposals.jobId, status: proposals.status })
          .from(proposals)
          .innerJoin(expertProfiles, eq(expertProfiles.id, proposals.expertId))
          .where(and(inArray(proposals.jobId, ids), eq(expertProfiles.userId, viewerUserId), ne(proposals.status, "WITHDRAWN")))
      : Promise.resolve([] as { jobId: string; status: string }[]),
  ]);
  return rows.map((r) => ({
    ...r.job,
    category: r.category,
    categorySlug: r.categorySlug,
    clientName: r.clientName,
    proposalCount: Number(counts.find((c) => c.jobId === r.job.id)?.n ?? 0),
    clientHires: Number(hires.find((h) => h.clientId === r.job.clientId)?.n ?? 0),
    applied: mine.some((m) => m.jobId === r.job.id),
    credits: creditsFor(r.job.budgetMaxMinor),
  }));
}

export type JobCard = Awaited<ReturnType<typeof listOpenJobs>>[number];

/** Open jobs that fit an expert: categories they sell in, or skills they list. */
export async function recommendedJobs(db: DB, expertUserId: string, limit = 4) {
  const profile = await expertProfileOf(db, expertUserId);
  if (!profile) return [];
  const cats = (await db.selectDistinct({ id: services.categoryId }).from(services).where(eq(services.expertId, profile.id))).map((c) => c.id);
  const skills = profile.skills.map((s) => s.toLowerCase());
  if (cats.length === 0 && skills.length === 0) return [];
  const conds = [];
  if (cats.length) conds.push(inArray(jobs.categoryId, cats));
  if (skills.length) conds.push(sql`exists (select 1 from unnest(${jobs.skills}) s where lower(s) in (${sql.join(skills.map((s) => sql`${s}`), sql`, `)}))`);
  const rows = await db
    .select({ job: jobs, category: categories.name, categorySlug: categories.slug, clientName: users.name })
    .from(jobs)
    .innerJoin(categories, eq(categories.id, jobs.categoryId))
    .innerJoin(users, eq(users.id, jobs.clientId))
    .where(and(eq(jobs.status, "OPEN"), ne(jobs.clientId, expertUserId), or(...conds)))
    .orderBy(desc(jobs.createdAt))
    .limit(limit * 3);
  return (await decorateJobs(db, rows, expertUserId)).filter((j) => !j.applied).slice(0, limit);
}

/** Trust signals about a client, shown to experts deciding whether to bid. */
export async function clientStats(db: DB, clientId: string) {
  const [[u], [posted], [hires], [rating]] = await Promise.all([
    db.select({ name: users.name, createdAt: users.createdAt }).from(users).where(eq(users.id, clientId)),
    db.select({ n: count() }).from(jobs).where(eq(jobs.clientId, clientId)),
    db.select({ n: count(), spent: sql<string | null>`sum(${orders.totalMinor})` }).from(orders).where(and(eq(orders.clientId, clientId), ne(orders.status, "AWAITING_PAYMENT"), ne(orders.status, "CANCELLED"))),
    db
      .select({ average: avg(reviews.rating), total: count(reviews.id) })
      .from(reviews)
      .innerJoin(orders, eq(orders.id, reviews.orderId))
      .where(and(eq(reviews.subjectId, clientId), eq(orders.clientId, clientId))),
  ]);
  return {
    name: u?.name ?? "Client",
    memberSince: u?.createdAt ?? new Date(),
    jobsPosted: Number(posted?.n ?? 0),
    hires: Number(hires?.n ?? 0),
    spentMinor: Number(hires?.spent ?? 0),
    rating: rating?.average ? Number(rating.average) : null,
    ratingCount: Number(rating?.total ?? 0),
  };
}

export async function getJob(db: DB, jobId: string) {
  const [row] = await db
    .select({ job: jobs, category: categories.name, categorySlug: categories.slug })
    .from(jobs)
    .innerJoin(categories, eq(categories.id, jobs.categoryId))
    .where(eq(jobs.id, jobId));
  if (!row) return null;
  const [{ n }] = await db.select({ n: count() }).from(proposals).where(and(eq(proposals.jobId, jobId), ne(proposals.status, "WITHDRAWN")));
  const [hired] = await db.select({ id: orders.id }).from(orders).innerJoin(proposals, eq(proposals.id, orders.proposalId)).where(eq(proposals.jobId, jobId));
  return { ...row.job, category: row.category, categorySlug: row.categorySlug, proposalCount: Number(n), orderId: hired?.id ?? null };
}

/** The viewer's own proposal on a job, if any (including withdrawn, so they can resubmit). */
export async function myProposal(db: DB, jobId: string, expertUserId: string) {
  const [p] = await db
    .select({ proposal: proposals })
    .from(proposals)
    .innerJoin(expertProfiles, eq(expertProfiles.id, proposals.expertId))
    .where(and(eq(proposals.jobId, jobId), eq(expertProfiles.userId, expertUserId)));
  return p?.proposal ?? null;
}

// ───────────── Proposals ─────────────

export type ProposalInput = { jobId: string; expertUserId: string; pitch: string; milestonePlan: MilestonePlanItem[] };

export function validatePlan(plan: MilestonePlanItem[]) {
  if (plan.length === 0) throw new JobError("Add at least one payment milestone.");
  if (plan.length > MAX_MILESTONES) throw new JobError(`Split the work into at most ${MAX_MILESTONES} milestones.`);
  const clean = plan.map((m, i) => {
    const title = m.title.trim().replace(/\s+/g, " ");
    if (title.length < 3 || title.length > 80) throw new JobError(`Milestone ${i + 1}: give it a short name (3–80 characters).`);
    if (!Number.isSafeInteger(m.amountMinor) || m.amountMinor < MIN_MILESTONE_MINOR) throw new JobError(`Milestone ${i + 1}: the minimum is GH₵10.`);
    if (!Number.isSafeInteger(m.dueInDays) || m.dueInDays < 1 || m.dueInDays > 365) throw new JobError(`Milestone ${i + 1}: delivery time must be 1–365 days.`);
    return { title, amountMinor: m.amountMinor, dueInDays: m.dueInDays };
  });
  const priceMinor = clean.reduce((s, m) => s + m.amountMinor, 0);
  if (priceMinor > MAX_BUDGET_MINOR) throw new JobError("Your total is above GH₵100,000.");
  return { plan: clean, priceMinor, timelineDays: clean.reduce((s, m) => s + m.dueInDays, 0) };
}

export async function submitProposal(db: DB, p: ProposalInput) {
  const pitch = p.pitch.trim();
  if (pitch.length < 50) throw new JobError("Tell the client how you'll approach the work (at least 50 characters).");
  if (pitch.length > 5000) throw new JobError("Your cover letter is limited to 5,000 characters.");
  const { plan, priceMinor, timelineDays } = validatePlan(p.milestonePlan);

  const result = await db.transaction(async (tx) => {
    const profile = await expertProfileOf(tx, p.expertUserId);
    if (!profile) throw new JobError("Only approved experts can send proposals.");
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, p.jobId)).for("update");
    if (!job) throw new JobError("This job no longer exists.");
    if (job.status !== "OPEN") throw new JobError("This job isn't taking proposals any more.");
    if (job.clientId === p.expertUserId) throw new JobError("You can't bid on your own job.");

    const [existing] = await tx.select().from(proposals).where(and(eq(proposals.jobId, job.id), eq(proposals.expertId, profile.id)));
    if (existing && existing.status !== "WITHDRAWN") throw new JobError("You've already sent a proposal for this job.");

    const cost = creditsFor(job.budgetMaxMinor);
    const balance = await creditBalance(tx, profile.id);
    if (balance < cost) {
      throw new JobError(`This job needs ${cost} credits and you have ${balance}. Your free credits top up on the 1st of next month.`);
    }
    await tx.update(expertProfiles).set({ bidCredits: balance - cost }).where(eq(expertProfiles.id, profile.id));

    const values = { priceMinor, timelineDays, pitch, milestonePlan: plan, status: "SUBMITTED" as const, creditsSpent: cost, viewedAt: null, currency: job.currency };
    const [saved] = existing
      ? await tx.update(proposals).set({ ...values, createdAt: new Date() }).where(eq(proposals.id, existing.id)).returning()
      : await tx.insert(proposals).values({ ...values, jobId: job.id, expertId: profile.id }).returning();
    return { proposal: saved, job, cost, balanceAfter: balance - cost };
  });

  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, p.expertUserId));
  await notify(db, {
    userId: result.job.clientId,
    kind: "NEW_PROPOSAL",
    title: `New proposal from ${me?.name?.split(" ")[0] ?? "an expert"} for “${result.job.title}”`,
    body: `${formatMoney(priceMinor, result.job.currency)} · ${timelineDays} day${timelineDays === 1 ? "" : "s"}`,
    link: `/jobs/${result.job.id}`,
  });
  return result;
}

export async function withdrawProposal(db: DB, proposalId: string, expertUserId: string) {
  const profile = await expertProfileOf(db, expertUserId);
  const res = await db
    .update(proposals)
    .set({ status: "WITHDRAWN" })
    .where(and(eq(proposals.id, proposalId), eq(proposals.expertId, profile?.id ?? "-"), inArray(proposals.status, ["SUBMITTED", "SHORTLISTED"])))
    .returning({ id: proposals.id });
  if (res.length === 0) throw new JobError("This proposal can't be withdrawn.");
}

async function ownedJob(db: DB | Tx, jobId: string, clientId: string, lock = false) {
  const q = db.select().from(jobs).where(eq(jobs.id, jobId));
  const [job] = lock ? await q.for("update") : await q;
  if (!job || job.clientId !== clientId) throw new JobError("Job not found.");
  return job;
}

async function proposalWithJob(db: DB | Tx, proposalId: string, clientId: string, lock = false) {
  const q = db.select().from(proposals).where(eq(proposals.id, proposalId));
  const [proposal] = lock ? await q.for("update") : await q;
  if (!proposal) throw new JobError("Proposal not found.");
  const job = await ownedJob(db, proposal.jobId, clientId, lock);
  return { proposal, job };
}

/** All live proposals on a client's job, with what they need to choose: reputation, fit and price. */
export async function listProposalsForJob(db: DB, jobId: string, clientId: string, opts: { markViewed?: boolean } = {}) {
  const job = await ownedJob(db, jobId, clientId);
  const rows = await db
    .select({ proposal: proposals, profile: expertProfiles, name: users.name, joined: users.createdAt })
    .from(proposals)
    .innerJoin(expertProfiles, eq(expertProfiles.id, proposals.expertId))
    .innerJoin(users, eq(users.id, expertProfiles.userId))
    .where(and(eq(proposals.jobId, jobId), ne(proposals.status, "WITHDRAWN")))
    .orderBy(desc(proposals.createdAt));
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => r.profile.userId);
  const profileIds = rows.map((r) => r.profile.id);
  const [ratings, completed, sellers] = await Promise.all([
    db
      .select({ userId: reviews.subjectId, average: avg(reviews.rating), total: count(reviews.id) })
      .from(reviews)
      .innerJoin(orders, eq(orders.id, reviews.orderId))
      .where(and(inArray(reviews.subjectId, userIds), sql`${orders.expertId} = ${reviews.subjectId}`))
      .groupBy(reviews.subjectId),
    db.select({ userId: orders.expertId, n: count() }).from(orders).where(and(inArray(orders.expertId, userIds), eq(orders.status, "COMPLETED"))).groupBy(orders.expertId),
    db.selectDistinct({ expertId: services.expertId }).from(services).where(and(inArray(services.expertId, profileIds), eq(services.categoryId, job.categoryId), eq(services.status, "ACTIVE"))),
  ]);
  if (opts.markViewed) {
    const unseen = rows.filter((r) => !r.proposal.viewedAt).map((r) => r.proposal.id);
    if (unseen.length) await db.update(proposals).set({ viewedAt: new Date() }).where(inArray(proposals.id, unseen));
  }
  const jobSkills = new Set(job.skills.map((s) => s.toLowerCase()));
  return rows.map((r) => {
    const rt = ratings.find((x) => x.userId === r.profile.userId);
    const rating = rt?.average ? Number(rt.average) : null;
    const done = Number(completed.find((c) => c.userId === r.profile.userId)?.n ?? 0);
    const topMatch = sellers.some((s) => s.expertId === r.profile.id);
    const sharedSkills = r.profile.skills.filter((s) => jobSkills.has(s.toLowerCase()));
    const inBudget = r.proposal.priceMinor <= job.budgetMaxMinor;
    const score = (topMatch ? 30 : 0) + sharedSkills.length * 8 + (rating ?? 4.2) * 6 + Math.min(done, 10) * 2 + (inBudget ? 10 : 0) + (r.proposal.status === "SHORTLISTED" ? 15 : 0);
    return {
      ...r.proposal,
      isNew: !r.proposal.viewedAt,
      expert: { userId: r.profile.userId, name: r.name ?? "Expert", headline: r.profile.headline, level: r.profile.level, skills: r.profile.skills, joined: r.joined },
      rating,
      ratingCount: Number(rt?.total ?? 0),
      completed: done,
      topMatch,
      sharedSkills,
      inBudget,
      score,
    };
  });
}

export type ProposalView = Awaited<ReturnType<typeof listProposalsForJob>>[number];

export async function setShortlisted(db: DB, proposalId: string, clientId: string, on: boolean) {
  const { proposal, job } = await proposalWithJob(db, proposalId, clientId);
  if (job.status !== "OPEN") throw new JobError("This job is no longer open.");
  if (!["SUBMITTED", "SHORTLISTED"].includes(proposal.status)) throw new JobError("This proposal can't be shortlisted.");
  await db.update(proposals).set({ status: on ? "SHORTLISTED" : "SUBMITTED" }).where(eq(proposals.id, proposalId));
}

export async function declineProposal(db: DB, proposalId: string, clientId: string) {
  const { proposal, job } = await proposalWithJob(db, proposalId, clientId);
  if (!["SUBMITTED", "SHORTLISTED"].includes(proposal.status)) throw new JobError("This proposal can't be declined.");
  await db.update(proposals).set({ status: "DECLINED" }).where(eq(proposals.id, proposalId));
  await notifyDeclined(db, [proposal.expertId], job.title, "The client chose not to go ahead with your proposal.");
}

async function notifyDeclined(db: DB, profileIds: string[], jobTitle: string, body: string) {
  if (profileIds.length === 0) return;
  const people = await db.select({ userId: expertProfiles.userId }).from(expertProfiles).where(inArray(expertProfiles.id, profileIds));
  await Promise.all(
    people.map((p) => notify(db, { userId: p.userId, kind: "PROPOSAL_DECLINED", title: `Update on “${jobTitle}”`, body, link: "/proposals" })),
  );
}

/** Hire: the proposal becomes an order with its milestones; everyone else is let down gently. */
export async function hireProposal(db: DB, p: { proposalId: string; clientId: string; feeBps?: number }) {
  const result = await db.transaction(async (tx) => {
    const { proposal, job } = await proposalWithJob(tx, p.proposalId, p.clientId, true);
    if (job.status !== "OPEN") throw new JobError("You've already hired for this job.");
    if (!["SUBMITTED", "SHORTLISTED"].includes(proposal.status)) throw new JobError("This proposal is no longer available.");
    const [profile] = await tx.select().from(expertProfiles).where(eq(expertProfiles.id, proposal.expertId));
    if (!profile) throw new JobError("This expert is no longer available.");

    const [order] = await tx
      .insert(orders)
      .values({
        clientId: job.clientId,
        expertId: profile.userId,
        proposalId: proposal.id,
        title: job.title,
        totalMinor: proposal.priceMinor,
        currency: proposal.currency,
        feeBps: p.feeBps ?? platformFeeBps(),
        requirements: [
          { question: "The job", answer: job.description },
          { question: "The expert's proposal", answer: proposal.pitch },
        ],
      })
      .returning();
    const now = Date.now();
    await tx.insert(milestones).values(
      proposal.milestonePlan.map((m, i) => ({
        orderId: order.id,
        position: i + 1,
        title: m.title,
        amountMinor: m.amountMinor,
        revisionsAllowed: 2,
        dueAt: new Date(now + m.dueInDays * DAY), // re-based when each milestone is funded
      })),
    );
    const [thread] = await tx.insert(threads).values({ orderId: order.id }).returning();
    await tx.insert(threadMembers).values([
      { threadId: thread.id, userId: job.clientId },
      { threadId: thread.id, userId: profile.userId },
    ]);

    await tx.update(proposals).set({ status: "ACCEPTED", viewedAt: proposal.viewedAt ?? new Date() }).where(eq(proposals.id, proposal.id));
    const others = await tx
      .update(proposals)
      .set({ status: "DECLINED" })
      .where(and(eq(proposals.jobId, job.id), ne(proposals.id, proposal.id), inArray(proposals.status, ["SUBMITTED", "SHORTLISTED"])))
      .returning({ expertId: proposals.expertId });
    await tx.update(jobs).set({ status: "HIRED" }).where(eq(jobs.id, job.id));
    return { order, job, expertUserId: profile.userId, others: others.map((o) => o.expertId) };
  });

  const [client] = await db.select({ name: users.name }).from(users).where(eq(users.id, p.clientId));
  await notify(db, {
    userId: result.expertUserId,
    kind: "HIRED",
    title: `You're hired! “${result.job.title}”`,
    body: `${client?.name?.split(" ")[0] ?? "The client"} accepted your proposal. Work starts as soon as the first milestone is paid into escrow.`,
    link: `/orders/${result.order.id}`,
    orderId: result.order.id,
  });
  await notifyDeclined(db, result.others, result.job.title, "The client hired another expert for this job. Thanks for bidding, and keep going!");
  return result.order;
}

/** Client closes a job without hiring: everyone's credits come back. */
export async function closeJob(db: DB, jobId: string, clientId: string) {
  const affected = await db.transaction(async (tx) => {
    const job = await ownedJob(tx, jobId, clientId, true);
    if (job.status !== "OPEN") throw new JobError("Only open jobs can be closed.");
    await tx.update(jobs).set({ status: "CANCELLED" }).where(eq(jobs.id, job.id));
    const live = await tx
      .update(proposals)
      .set({ status: "DECLINED" })
      .where(and(eq(proposals.jobId, job.id), inArray(proposals.status, ["SUBMITTED", "SHORTLISTED"])))
      .returning({ expertId: proposals.expertId, credits: proposals.creditsSpent });
    for (const l of live) {
      await tx.update(expertProfiles).set({ bidCredits: sql`${expertProfiles.bidCredits} + ${l.credits}` }).where(eq(expertProfiles.id, l.expertId));
    }
    return { job, live };
  });
  await notifyDeclined(db, affected.live.map((l) => l.expertId), affected.job.title, "The client closed this job without hiring. Your credits have been returned.");
}

// ───────────── Lists ─────────────

export async function listJobsForClient(db: DB, clientId: string) {
  const rows = await db
    .select({ job: jobs, category: categories.name })
    .from(jobs)
    .innerJoin(categories, eq(categories.id, jobs.categoryId))
    .where(eq(jobs.clientId, clientId))
    .orderBy(desc(jobs.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.job.id);
  const [stats, hired] = await Promise.all([
    db
      .select({
        jobId: proposals.jobId,
        total: count(),
        unseen: sql<number>`count(*) filter (where ${proposals.viewedAt} is null)`.mapWith(Number),
        shortlisted: sql<number>`count(*) filter (where ${proposals.status} = 'SHORTLISTED')`.mapWith(Number),
      })
      .from(proposals)
      .where(and(inArray(proposals.jobId, ids), ne(proposals.status, "WITHDRAWN")))
      .groupBy(proposals.jobId),
    db.select({ jobId: proposals.jobId, orderId: orders.id }).from(orders).innerJoin(proposals, eq(proposals.id, orders.proposalId)).where(inArray(proposals.jobId, ids)),
  ]);
  return rows.map((r) => {
    const s = stats.find((x) => x.jobId === r.job.id);
    return { ...r.job, category: r.category, proposals: Number(s?.total ?? 0), unseen: s?.unseen ?? 0, shortlisted: s?.shortlisted ?? 0, orderId: hired.find((h) => h.jobId === r.job.id)?.orderId ?? null };
  });
}

export async function listProposalsForExpert(db: DB, expertUserId: string) {
  const profile = await expertProfileOf(db, expertUserId);
  if (!profile) return [];
  return db
    .select({
      proposal: proposals,
      jobTitle: jobs.title,
      jobStatus: jobs.status,
      budgetMinMinor: jobs.budgetMinMinor,
      budgetMaxMinor: jobs.budgetMaxMinor,
      clientName: users.name,
      orderId: orders.id,
    })
    .from(proposals)
    .innerJoin(jobs, eq(jobs.id, proposals.jobId))
    .innerJoin(users, eq(users.id, jobs.clientId))
    .leftJoin(orders, eq(orders.proposalId, proposals.id))
    .where(eq(proposals.expertId, profile.id))
    .orderBy(desc(proposals.createdAt));
}

/** The next milestone a client can fund, once nothing else is in progress (milestones run one at a time). */
export function nextFundable<T extends { status: string; position: number }>(ms: T[]): T | null {
  if (ms.some((m) => ["FUNDED", "DELIVERED", "REVISION_REQUESTED"].includes(m.status))) return null;
  return [...ms].sort((a, b) => a.position - b.position).find((m) => m.status === "PENDING_FUNDING") ?? null;
}
