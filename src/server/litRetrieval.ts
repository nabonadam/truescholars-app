/**
 * Literature retrieval by an expert, through the marketplace:
 *   the client sends the brief → it becomes a job in "Literature review support" → the client hires an
 *   expert (proposal + escrow, as for any job) → the expert works in the review's retrieval workspace
 *   (adds PDFs / DOIs with relevance notes, records the search log) → submits, which delivers the order
 *   milestone with the papers spreadsheet → the client accepts or rejects each paper → they either ask for
 *   replacements (a revision) or submit for analysis, which approves the delivery and releases payment.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, litPapers, litReviews, milestones, orders, proposals } from "@/db/schema";
import { approveDelivery, requestRevision, submitDelivery } from "./orderRoom";
import { saveUploads } from "./files";
import { type Brief, LitError, type ReviewRow, cleanBrief, listPapers, mustOwn, touch } from "./lit";
import { litExport } from "./litExport";
import { notify } from "./notifications";
import { postJob } from "./jobs";

export type SearchLog = {
  databases: string[];
  searchStrings: string;
  dateRange: string;
  inclusion: string;
  exclusion: string;
  identified: number; // records found in all databases
  duplicates: number; // duplicates removed
  screened: number; // titles/abstracts screened
  excludedScreening: number;
  fullText: number; // full texts assessed
  excludedFullText: number;
  included: number;
};

export const RETRIEVAL_CATEGORY = "literature-review-support";
const n = (v: unknown) => Math.max(0, Math.min(1_000_000, Math.round(Number(v) || 0)));

export function cleanLog(l: Partial<SearchLog>): SearchLog {
  const s = (v: unknown, k = 2000) => (typeof v === "string" ? v.trim().slice(0, k) : "");
  return {
    databases: (Array.isArray(l.databases) ? l.databases : String(l.databases ?? "").split(/[,;\n]/)).map((d) => String(d).trim().slice(0, 80)).filter(Boolean).slice(0, 20),
    searchStrings: s(l.searchStrings, 4000),
    dateRange: s(l.dateRange, 80),
    inclusion: s(l.inclusion),
    exclusion: s(l.exclusion),
    identified: n(l.identified),
    duplicates: n(l.duplicates),
    screened: n(l.screened),
    excludedScreening: n(l.excludedScreening),
    fullText: n(l.fullText),
    excludedFullText: n(l.excludedFullText),
    included: n(l.included),
  };
}

/** The methods paragraph a thesis or article needs, written from the search log. */
export function methodsParagraph(log: SearchLog, papers: number): string {
  const dbs = log.databases.length ? log.databases.join(", ").replace(/, ([^,]*)$/, " and $1") : "academic databases";
  return [
    `Literature was identified through a structured search of ${dbs}${log.dateRange ? `, covering ${log.dateRange}` : ""}.`,
    log.searchStrings ? `Search terms combined: ${log.searchStrings.replace(/\s+/g, " ")}.` : "",
    log.inclusion ? `Studies were included if they met the following criteria: ${log.inclusion.replace(/\.$/, "")}.` : "",
    log.exclusion ? `Studies were excluded if: ${log.exclusion.replace(/\.$/, "")}.` : "",
    log.identified ? `The search identified ${log.identified} records; after removing ${log.duplicates} duplicates, ${log.screened || log.identified - log.duplicates} titles and abstracts were screened and ${log.excludedScreening} excluded. ${log.fullText} full texts were assessed for eligibility, of which ${log.excludedFullText} were excluded, leaving ${log.included || papers} studies for the review.` : `${papers} studies were included in the review.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Placeholder prices until the real pricing is set: per paper requested, in pesewas. */
export function suggestedBudget(papersWanted = 20) {
  const k = Math.max(5, Math.min(200, papersWanted));
  return { min: k * 1500, max: k * 2500 }; // GH₵15–25 per paper
}

export async function requestRetrieval(db: DB, ownerId: string, reviewId: string, input: { brief: Brief; budgetMin: number; budgetMax: number; days: number }) {
  const r = await mustOwn(db, ownerId, reviewId);
  if (r.jobId && r.status !== "DRAFT" && r.status !== "ANALYSIS") throw new LitError("You've already asked an expert for this review.");
  const brief = cleanBrief({ ...(r.brief as Brief), ...input.brief });
  const [cat] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, RETRIEVAL_CATEGORY));
  if (!cat) throw new LitError("The literature retrieval category isn't set up yet.");
  const line = (label: string, v?: string | number) => (v ? `${label}: ${v}\n` : "");
  const description =
    `Find relevant, high-quality academic literature for this research question, and deliver it in The True Scholars literature workspace (a link appears in your order once you're hired).\n\n` +
    `Research question: ${r.researchQuestion}\n\n` +
    line("Papers wanted", brief.papersWanted) +
    line("Purpose", brief.purpose) +
    line("Discipline", brief.discipline) +
    line("Years", brief.years) +
    line("Regions / settings", brief.regions) +
    line("Languages", brief.languages) +
    line("Include", brief.include) +
    line("Exclude", brief.exclude) +
    line("Notes", brief.notes) +
    `\nWhat to deliver: for each paper, the PDF where it is open access (or the DOI only for paywalled papers, which the client will attach from their library), a one or two sentence note on why it is relevant, and the search log (databases, search strings, criteria and the counts for a PRISMA diagram).`;
  const job = await postJob(db, ownerId, {
    title: `Literature retrieval: ${r.title}`.slice(0, 100).padEnd(10, "."),
    categoryId: cat.id,
    description: description.slice(0, 6000),
    skills: ["Literature search", "Systematic review", brief.discipline ?? ""].filter(Boolean),
    budgetMinMinor: Math.round(input.budgetMin),
    budgetMaxMinor: Math.round(Math.max(input.budgetMin, input.budgetMax)),
    timelineDays: Math.max(1, Math.min(60, Math.round(input.days))) || 7,
    level: "masters",
  });
  await db.update(litReviews).set({ brief, jobId: job.id, status: "RETRIEVAL", expertUserId: null, orderId: null, deliveredAt: null }).where(eq(litReviews.id, reviewId));
  return job.id;
}

/** Links the review to the order once the client hires an expert on its job. */
export async function linkHire(db: DB, r: ReviewRow): Promise<ReviewRow> {
  if (!r.jobId || r.expertUserId) return r;
  const [o] = await db
    .select({ id: orders.id, expertId: orders.expertId })
    .from(orders)
    .innerJoin(proposals, eq(proposals.id, orders.proposalId))
    .where(eq(proposals.jobId, r.jobId));
  if (!o) return r;
  await db.update(litReviews).set({ orderId: o.id, expertUserId: o.expertId }).where(eq(litReviews.id, r.id));
  return { ...r, orderId: o.id, expertUserId: o.expertId };
}

/** The review attached to an order, if any (for the order page's link to the workspace). */
export async function reviewForOrder(db: DB, orderId: string) {
  const [r] = await db.select({ id: litReviews.id }).from(litReviews).where(eq(litReviews.orderId, orderId));
  return r?.id ?? null;
}

async function currentMilestone(db: DB, orderId: string, statuses: string[]) {
  const ms = await db.select().from(milestones).where(eq(milestones.orderId, orderId)).orderBy(asc(milestones.position));
  return ms.find((m) => statuses.includes(m.status)) ?? null;
}

export async function saveSearchLog(db: DB, expertUserId: string, reviewId: string, log: Partial<SearchLog>) {
  const [r] = await db.select().from(litReviews).where(eq(litReviews.id, reviewId));
  if (!r || r.expertUserId !== expertUserId) throw new LitError("Review not found.");
  if (r.status !== "RETRIEVAL") throw new LitError("This literature has already been delivered.");
  await db.update(litReviews).set({ searchLog: cleanLog(log) }).where(eq(litReviews.id, reviewId));
}

/** The expert delivers: the papers spreadsheet goes into the order as the delivery, and the client is asked to review. */
export async function submitRetrieval(db: DB, expertUserId: string, reviewId: string, note: string) {
  const [r] = await db.select().from(litReviews).where(eq(litReviews.id, reviewId));
  if (!r || r.expertUserId !== expertUserId || !r.orderId) throw new LitError("Review not found.");
  if (r.status !== "RETRIEVAL") throw new LitError("This literature has already been delivered.");
  const pending = (await listPapers(db, reviewId)).filter((p) => p.status === "PENDING");
  if (!pending.length) throw new LitError("Add the papers you found before submitting.");
  if (!r.searchLog || !(r.searchLog as SearchLog).databases?.length) throw new LitError("Fill in the search log (at least the databases you searched) before submitting.");
  const m = await currentMilestone(db, r.orderId, ["FUNDED", "REVISION_REQUESTED"]);
  if (!m) throw new LitError("The client hasn't paid this job into escrow yet. Wait for the payment before delivering.");
  const sheet = await litExport(db, r, "spreadsheet");
  const fileIds = await saveUploads(db, { orderId: r.orderId, ownerId: expertUserId, uploads: [new File([sheet!.body as string], "literature-retrieval.csv", { type: "text/csv" })] });
  await submitDelivery(db, { milestoneId: m.id, expertId: expertUserId, note: note.trim() || `${pending.length} papers delivered in the literature workspace.`, fileIds });
  await db.update(litReviews).set({ status: "REVIEWING", deliveredAt: new Date() }).where(eq(litReviews.id, reviewId));
  await notify(db, { userId: r.ownerId, kind: "LIT_REVIEW", title: `Your expert has submitted the literature for “${r.title}”`, body: `${pending.length} papers are ready for you to review. Accept the ones you want, then submit for analysis.`, link: `/tools/lit/${r.id}` });
}

/** The client asks the expert to replace rejected papers (a revision on the order). */
export async function askReplacements(db: DB, ownerId: string, reviewId: string, message: string) {
  const r = await mustOwn(db, ownerId, reviewId);
  if (r.status !== "REVIEWING" || !r.orderId) throw new LitError("There's no delivery to send back.");
  const papers = await listPapers(db, reviewId);
  const rejected = papers.filter((p) => p.source === "EXPERT" && p.status === "REJECTED");
  const m = await currentMilestone(db, r.orderId, ["DELIVERED"]);
  if (!m) throw new LitError("There's no delivery to send back.");
  const reasons = rejected.map((p) => `- ${(p.meta as { title?: string }).title ?? `Paper ${p.n}`}: ${p.rejectReason ?? ""}`).join("\n");
  await requestRevision(db, { milestoneId: m.id, clientId: ownerId, reason: `${message.trim() || "Please replace the papers I rejected."}${reasons ? `\n\nRejected:\n${reasons}` : ""}` });
  await db.update(litReviews).set({ status: "RETRIEVAL" }).where(eq(litReviews.id, reviewId));
  if (r.expertUserId) await notify(db, { userId: r.expertUserId, kind: "LIT_REVIEW", title: `Replacements requested for “${r.title}”`, body: message.trim().slice(0, 300) || "The client rejected some papers. Add replacements in the workspace, then submit again.", link: `/tools/lit/${r.id}` });
}

/** The client is happy with the literature: approve the delivery (releasing payment) and start the analysis. */
export async function acceptLiterature(db: DB, ownerId: string, reviewId: string) {
  const r = await mustOwn(db, ownerId, reviewId);
  if (r.status !== "REVIEWING") throw new LitError("There's no delivered literature to accept.");
  const papers = await listPapers(db, reviewId);
  if (papers.some((p) => p.status === "PENDING")) throw new LitError("Accept or reject every paper first.");
  if (!papers.some((p) => p.status === "ACCEPTED")) throw new LitError("Accept at least one paper, or ask for replacements.");
  if (r.orderId) {
    const m = await currentMilestone(db, r.orderId, ["DELIVERED"]);
    if (m) await approveDelivery(db, { milestoneId: m.id, clientId: ownerId });
  }
  await db.update(litReviews).set({ status: "ANALYSIS" }).where(eq(litReviews.id, reviewId));
  await touch(db, reviewId);
}

/** If the delivery was approved in the order room (or automatically after 3 days), move the review on too. */
export async function syncWithOrder(db: DB, r: ReviewRow): Promise<ReviewRow> {
  if (!r.orderId || (r.status !== "REVIEWING" && r.status !== "RETRIEVAL")) return r;
  const ms = await db.select({ status: milestones.status }).from(milestones).where(eq(milestones.orderId, r.orderId));
  if (ms.length && ms.every((m) => ["APPROVED", "REFUNDED"].includes(m.status)) && r.status === "REVIEWING") {
    await db.update(litPapers).set({ status: "ACCEPTED" }).where(and(eq(litPapers.reviewId, r.id), eq(litPapers.status, "PENDING")));
    await db.update(litReviews).set({ status: "ANALYSIS" }).where(eq(litReviews.id, r.id));
    return { ...r, status: "ANALYSIS" };
  }
  return r;
}

export async function orderStatus(db: DB, orderId: string | null) {
  if (!orderId) return null;
  const [o] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  const ms = await db.select({ status: milestones.status }).from(milestones).where(inArray(milestones.orderId, [orderId]));
  return { order: o?.status ?? null, funded: ms.some((m) => m.status !== "PENDING_FUNDING") };
}
