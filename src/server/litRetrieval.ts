/**
 * Literature retrieval by a dedicated expert, assigned privately:
 *   the client sends the brief → it goes to the admins only (never the public job board, so the research
 *   question stays private) → an admin assigns one of the experts who signed up as literature retrievers,
 *   at a set price → that creates an order with one escrow milestone, which the client pays → the expert
 *   works in the review's retrieval workspace (adds PDFs / DOIs with relevance notes, records the search
 *   log) → submits, which delivers the milestone with the papers spreadsheet → the client accepts or
 *   rejects each paper → they either ask for replacements (a revision) or submit for analysis, which
 *   approves the delivery and releases payment.
 * Reviews from before this change may still have a public job (jobId); linkHire keeps those working.
 */

import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { expertProfiles, litPapers, litReviews, milestones, orders, proposals, threadMembers, threads, users } from "@/db/schema";
import { approveDelivery, requestRevision, submitDelivery } from "./orderRoom";
import { platformFeeBps } from "./orders";
import { saveUploads } from "./files";
import { type Brief, LitError, type ReviewRow, cleanBrief, listPapers, mustOwn, touch } from "./lit";
import { litExport } from "./litExport";
import { notify } from "./notifications";

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

const n = (v: unknown) => Math.max(0, Math.min(1_000_000, Math.round(Number(v) || 0)));
const DAY = 86_400_000;
const cedis = (minor: number) => `GH₵${(minor / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

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

function briefLines(r: { researchQuestion: string }, b: Brief, days?: number | null) {
  const line = (label: string, v?: string | number | null) => (v ? `${label}: ${v}\n` : "");
  return (
    line("Papers wanted", b.papersWanted) +
    line("Purpose", b.purpose) +
    line("Discipline", b.discipline) +
    line("Years", b.years) +
    line("Regions / settings", b.regions) +
    line("Languages", b.languages) +
    line("Include", b.include) +
    line("Exclude", b.exclude) +
    line("Needed within", days ? `${days} days` : null) +
    line("Notes", b.notes)
  ).trim();
}

/** Everyone who should hear about a new request: ADMIN accounts, plus anyone listed in ADMIN_EMAILS. */
async function adminIds(db: DB) {
  const emails = (process.env.ADMIN_EMAILS ?? "").toLowerCase().split(",").map((e) => e.trim()).filter(Boolean);
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(emails.length ? or(sql`'ADMIN'::role = any(${users.roles})`, inArray(sql`lower(${users.email})`, emails)) : sql`'ADMIN'::role = any(${users.roles})`);
  return rows.map((u) => u.id);
}

/** The client asks for an expert. The brief goes to the admins only; nothing is posted on the marketplace. */
export async function requestRetrieval(db: DB, ownerId: string, reviewId: string, input: { brief: Brief; days: number }) {
  const r = await mustOwn(db, ownerId, reviewId);
  if (!["DRAFT", "ANALYSIS"].includes(r.status)) throw new LitError("You've already asked for an expert for this review.");
  if (r.researchQuestion.trim().length < 10) throw new LitError("Write your research question first: it's what the expert searches for.");
  const brief = cleanBrief({ ...(r.brief as Brief), ...input.brief });
  const days = Math.max(1, Math.min(60, Math.round(input.days) || 7));
  await db
    .update(litReviews)
    .set({ brief, status: "REQUESTED", requestedAt: new Date(), requestDays: days, assignedAt: null, jobId: null, expertUserId: null, orderId: null, deliveredAt: null, searchLog: null })
    .where(eq(litReviews.id, reviewId));
  for (const id of await adminIds(db)) {
    await notify(db, {
      userId: id,
      kind: "LIT_REQUEST",
      title: "New request for literature retrieval",
      body: `${brief.papersWanted ?? 20} papers, needed within ${days} days. Assign a literature retriever.`,
      link: "/admin/retrieval",
    });
  }
}

/** The client withdraws the request, while no expert has started (nothing paid). */
export async function cancelRequest(db: DB, ownerId: string, reviewId: string) {
  const r = await mustOwn(db, ownerId, reviewId);
  if (r.status === "REQUESTED") {
    await db.update(litReviews).set({ status: "DRAFT", requestedAt: null, requestDays: null }).where(eq(litReviews.id, reviewId));
    return;
  }
  if (r.status === "RETRIEVAL" && r.orderId && (await unpaid(db, r.orderId))) {
    await dropAssignment(db, r, "DRAFT");
    if (r.expertUserId) await notify(db, { userId: r.expertUserId, kind: "LIT_REVIEW", title: "A literature retrieval assignment was withdrawn", body: "The client withdrew the request before paying, so there's nothing to do.", link: "/orders" });
    return;
  }
  throw new LitError("This request can't be withdrawn now. If there's a problem with the work, use the order page.");
}

async function unpaid(db: DB, orderId: string) {
  const ms = await db.select({ status: milestones.status }).from(milestones).where(eq(milestones.orderId, orderId));
  return ms.every((m) => m.status === "PENDING_FUNDING");
}

async function dropAssignment(db: DB, r: ReviewRow, back: "DRAFT" | "REQUESTED") {
  if (r.orderId) await db.update(orders).set({ status: "CANCELLED" }).where(eq(orders.id, r.orderId));
  await db
    .update(litReviews)
    .set({ status: back, expertUserId: null, orderId: null, assignedAt: null, ...(back === "DRAFT" ? { requestedAt: null, requestDays: null } : {}) })
    .where(eq(litReviews.id, r.id));
}

// ───────── admin: the queue, the retrievers, assigning ─────────

export async function listRetrievalRequests(db: DB) {
  const owner = sql<string>`(select coalesce(u.name, u.email) from ${users} u where u.id = ${litReviews.ownerId})`;
  const ownerEmail = sql<string>`(select u.email from ${users} u where u.id = ${litReviews.ownerId})`;
  const expert = sql<string | null>`(select coalesce(u.name, u.email) from ${users} u where u.id = ${litReviews.expertUserId})`;
  const total = sql<number | null>`(select o.total_minor from ${orders} o where o.id = ${litReviews.orderId})`;
  const paid = sql<boolean>`exists (select 1 from ${milestones} m where m.order_id = ${litReviews.orderId} and m.status <> 'PENDING_FUNDING')`;
  const papers = sql<number>`(select count(*)::int from ${litPapers} p where p.review_id = ${litReviews.id} and p.source = 'EXPERT')`;
  return db
    .select({
      id: litReviews.id,
      title: litReviews.title,
      researchQuestion: litReviews.researchQuestion,
      brief: litReviews.brief,
      status: litReviews.status,
      requestedAt: litReviews.requestedAt,
      requestDays: litReviews.requestDays,
      assignedAt: litReviews.assignedAt,
      deliveredAt: litReviews.deliveredAt,
      orderId: litReviews.orderId,
      expertUserId: litReviews.expertUserId,
      owner,
      ownerEmail,
      expert,
      total,
      paid,
      papers,
    })
    .from(litReviews)
    .where(isNotNull(litReviews.requestedAt))
    .orderBy(desc(litReviews.requestedAt));
}

export const openRequestCount = async (db: DB) => (await db.select({ id: litReviews.id }).from(litReviews).where(eq(litReviews.status, "REQUESTED"))).length;

/** Experts who signed up for literature retrieval, with how much they're working on now. */
export async function listRetrievers(db: DB) {
  const active = sql<number>`(select count(*)::int from ${litReviews} r where r.expert_user_id = ${expertProfiles.userId} and r.status in ('RETRIEVAL', 'REVIEWING'))`;
  const done = sql<number>`(select count(*)::int from ${litReviews} r where r.expert_user_id = ${expertProfiles.userId} and r.status = 'ANALYSIS')`;
  return db
    .select({ userId: expertProfiles.userId, name: users.name, email: users.email, headline: expertProfiles.headline, verifiedAt: expertProfiles.verifiedAt, active, done })
    .from(expertProfiles)
    .innerJoin(users, eq(users.id, expertProfiles.userId))
    .where(and(eq(expertProfiles.litRetriever, true), sql`'EXPERT'::role = any(${users.roles})`))
    .orderBy(asc(users.name));
}

export async function addRetrieverByEmail(db: DB, email: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`);
  if (!u) throw new LitError("No account with that email.");
  await setRetriever(db, u.id, true);
}

export async function setRetriever(db: DB, userId: string, on: boolean) {
  const [p] = await db.update(expertProfiles).set({ litRetriever: on }).where(eq(expertProfiles.userId, userId)).returning({ id: expertProfiles.id });
  if (!p) throw new LitError("That person doesn't have an expert profile.");
}

/** Admin: give the request to one retriever at a price. Creates the private order the client pays into escrow. */
export async function assignRetriever(db: DB, reviewId: string, input: { expertUserId: string; priceMinor: number; days: number; note?: string }) {
  const [r] = await db.select().from(litReviews).where(eq(litReviews.id, reviewId));
  if (!r) throw new LitError("Request not found.");
  if (r.status !== "REQUESTED") throw new LitError("This request has already been assigned.");
  const [ex] = await db
    .select({ userId: expertProfiles.userId, name: users.name, roles: users.roles, retriever: expertProfiles.litRetriever })
    .from(expertProfiles)
    .innerJoin(users, eq(users.id, expertProfiles.userId))
    .where(eq(expertProfiles.userId, input.expertUserId));
  if (!ex || !ex.roles.includes("EXPERT") || !ex.retriever) throw new LitError("Choose one of the literature retrievers.");
  if (ex.userId === r.ownerId) throw new LitError("The expert can't be the client.");
  const price = Math.round(input.priceMinor);
  if (!(price >= 1000)) throw new LitError("Set a price of at least GH₵10.");
  const days = Math.max(1, Math.min(60, Math.round(input.days) || r.requestDays || 7));
  const brief = (r.brief ?? {}) as Brief;
  const note = (input.note ?? "").trim().slice(0, 2000);

  const order = await db.transaction(async (tx) => {
    const [o] = await tx
      .insert(orders)
      .values({
        clientId: r.ownerId,
        expertId: ex.userId,
        title: `Literature retrieval: ${r.title}`.slice(0, 140),
        totalMinor: price,
        feeBps: platformFeeBps(),
        requirements: [
          { question: "Research question", answer: r.researchQuestion },
          { question: "Brief", answer: briefLines(r, brief, days) || "See the literature workspace." },
          ...(note ? [{ question: "Note from The True Scholars", answer: note }] : []),
          { question: "Where to work", answer: "Add the papers and the search log in the literature workspace (linked at the top of this order), then submit them from there." },
        ],
      })
      .returning();
    await tx.insert(milestones).values({ orderId: o.id, position: 1, title: `${brief.papersWanted ?? 20} papers with search log`, amountMinor: price, revisionsAllowed: 2, dueAt: new Date(Date.now() + days * DAY) });
    const [t] = await tx.insert(threads).values({ orderId: o.id }).returning();
    await tx.insert(threadMembers).values([{ threadId: t.id, userId: r.ownerId }, { threadId: t.id, userId: ex.userId }]);
    await tx.update(litReviews).set({ status: "RETRIEVAL", expertUserId: ex.userId, orderId: o.id, assignedAt: new Date(), requestDays: days }).where(eq(litReviews.id, r.id));
    return o;
  });

  await notify(db, {
    userId: ex.userId,
    kind: "LIT_REVIEW",
    title: `New literature retrieval assignment: “${r.title}”`,
    body: `${brief.papersWanted ?? 20} papers within ${days} days, for ${cedis(price)}. Start once the client has paid into escrow; you'll be notified.`,
    link: `/tools/lit/${r.id}`,
    orderId: order.id,
  });
  await notify(db, {
    userId: r.ownerId,
    kind: "LIT_REVIEW",
    title: `A literature expert has been assigned to “${r.title}”`,
    body: `The price is ${cedis(price)} for ${brief.papersWanted ?? 20} papers within ${days} days. Pay into escrow to start; the expert is paid only when you accept the literature.`,
    link: `/orders/${order.id}`,
    orderId: order.id,
  });
  return order;
}

/** Admin: take the request back from an expert (before the client has paid), to reassign it or close it. */
export async function unassignRetriever(db: DB, reviewId: string) {
  const [r] = await db.select().from(litReviews).where(eq(litReviews.id, reviewId));
  if (!r || r.status !== "RETRIEVAL" || !r.orderId) throw new LitError("This request isn't assigned.");
  if (!(await unpaid(db, r.orderId))) throw new LitError("The client has already paid. Handle changes through the order (a refund or a dispute).");
  await dropAssignment(db, r, "REQUESTED");
  if (r.expertUserId) await notify(db, { userId: r.expertUserId, kind: "LIT_REVIEW", title: `Assignment moved: “${r.title}”`, body: "This literature retrieval has been given to another expert. You don't need to do anything.", link: "/orders" });
}

/** Admin: decline a request (for example, outside what we can source), telling the client why. */
export async function declineRequest(db: DB, reviewId: string, reason: string) {
  const [r] = await db.select().from(litReviews).where(eq(litReviews.id, reviewId));
  if (!r || r.status !== "REQUESTED") throw new LitError("Only unassigned requests can be declined.");
  if (!reason.trim()) throw new LitError("Tell the client why.");
  await dropAssignment(db, r, "DRAFT");
  await notify(db, { userId: r.ownerId, kind: "LIT_REVIEW", title: `We couldn't take on the literature request for “${r.title}”`, body: reason.trim().slice(0, 500), link: `/tools/lit/${r.id}` });
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
  const open = pending.filter((p) => !p.confirmedAt);
  if (open.length) throw new LitError(`Fill in the record for ${open.map((p) => `P${String(p.n).padStart(2, "0")}`).join(", ")}: details, summary, relevance and your confirmation that you read it.`);
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

/** What the client and expert see about the assignment: who, how much, whether it's paid. */
export async function assignmentInfo(db: DB, r: ReviewRow) {
  if (!r.orderId) return null;
  const [o] = await db.select({ total: orders.totalMinor, status: orders.status, expert: users.name }).from(orders).innerJoin(users, eq(users.id, orders.expertId)).where(eq(orders.id, r.orderId));
  if (!o) return null;
  const ms = await db.select({ status: milestones.status, dueAt: milestones.dueAt }).from(milestones).where(eq(milestones.orderId, r.orderId));
  return { orderId: r.orderId, total: o.total, expert: o.expert?.split(" ")[0] ?? "Your expert", paid: ms.some((m) => m.status !== "PENDING_FUNDING"), dueAt: ms[0]?.dueAt ?? null };
}
export type AssignmentInfo = Awaited<ReturnType<typeof assignmentInfo>>;

export async function orderStatus(db: DB, orderId: string | null) {
  if (!orderId) return null;
  const [o] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  const ms = await db.select({ status: milestones.status }).from(milestones).where(inArray(milestones.orderId, [orderId]));
  return { order: o?.status ?? null, funded: ms.some((m) => m.status !== "PENDING_FUNDING") };
}
