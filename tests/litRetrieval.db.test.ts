import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { fundMilestone } from "@/server/escrow";
import { addDoi, createReview, decidePaper, getReview, listPapers, recordPaper } from "@/server/lit";
import { acceptLiterature, askReplacements, assignRetriever, cancelRequest, declineRequest, listRetrievalRequests, listRetrievers, methodsParagraph, requestRetrieval, reviewForOrder, saveSearchLog, submitRetrieval, unassignRetriever } from "@/server/litRetrieval";
import { approveApplication, submitApplication } from "@/server/vetting";

let db: DB;
let client: string, expert: string, other: string, admin: string;
const crossref = async (g: { doi?: string }) => ({ meta: { title: `Paper ${g.doi}`, authors: [{ family: "Mensah" }], year: 2020, doi: g.doi }, verify: { checked: true, found: true } });

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [c] = await d.insert(schema.users).values({ email: "akosua@example.com", name: "Akosua" }).returning();
  const [e] = await d.insert(schema.users).values({ email: "ama@example.com", name: "Ama" }).returning();
  client = c.id;
  expert = e.id;
  const [o] = await d.insert(schema.users).values({ email: "kofi@example.com", name: "Kofi" }).returning();
  const [a] = await d.insert(schema.users).values({ email: "admin@example.com", name: "Admin", roles: ["CLIENT", "ADMIN"] }).returning();
  other = o.id;
  admin = a.id;
  // Ama signs up as a literature retriever; Kofi is an expert who didn't
  const app = await submitApplication(db, expert, { qualification: "PhD", fields: ["Sociology"], experienceYears: 5, pitch: "p".repeat(90), cvUrl: "https://x.org/cv", litRetriever: true });
  await approveApplication(db, { applicationId: app.id });
  const app2 = await submitApplication(db, other, { qualification: "PhD", fields: ["Sociology"], experienceYears: 5, pitch: "p".repeat(90), cvUrl: "https://x.org/cv" });
  await approveApplication(db, { applicationId: app2.id });
});

const summary = "A household survey of 400 farmers in northern Ghana found that access to credit and labour shaped which adaptation strategies they adopted, with women facing the tightest constraints.";
const record = async (reviewId: string, n: number, over: Partial<Parameters<typeof recordPaper>[3]> = {}) => {
  const p = (await listPapers(db, reviewId)).find((x) => x.n === n)!;
  return recordPaper(db, expert, p.id, { meta: { title: `Paper ${p.meta.doi}`, authors: [{ family: "Mensah", given: "K." }], year: 2020, doi: p.meta.doi }, summary, note: "Directly studies adaptation to rainfall variability among smallholders.", confirmed: true, ...over }, crossref);
};

const notes = (userId: string) => db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));

describe("literature retrieval by an expert", () => {
  it("is private: goes to the admins, who assign a retriever; never a public job", async () => {
    const id = await createReview(db, client, { title: "Rainfall and adaptation", researchQuestion: "How do farmers adapt to rainfall variability?" });
    await requestRetrieval(db, client, id, { brief: { papersWanted: 10 }, days: 5 });
    expect(await db.select().from(schema.jobs)).toHaveLength(0);
    expect((await getReview(db, client, id))!.status).toBe("REQUESTED");
    expect((await notes(admin)).map((n) => n.kind)).toEqual(["LIT_REQUEST"]);
    expect((await notes(admin))[0].body).not.toContain("rainfall"); // the question isn't in the email
    expect(await getReview(db, expert, id)).toBeNull();

    expect((await listRetrievers(db)).map((r) => r.userId)).toEqual([expert]);
    await expect(assignRetriever(db, id, { expertUserId: other, priceMinor: 20_000, days: 5 })).rejects.toThrow(/literature retrievers/);
    await assignRetriever(db, id, { expertUserId: expert, priceMinor: 20_000, days: 5 });
    expect((await getReview(db, expert, id))!.role).toBe("expert");
    expect(await getReview(db, other, id)).toBeNull();

    // reassign before payment: the first expert loses access, the unpaid order is cancelled
    await unassignRetriever(db, id);
    expect(await getReview(db, expert, id)).toBeNull();
    expect((await db.select().from(schema.orders))[0].status).toBe("CANCELLED");
    expect((await listRetrievalRequests(db))[0].status).toBe("REQUESTED");

    // the client can withdraw; the admin can decline with a reason
    await cancelRequest(db, client, id);
    expect((await getReview(db, client, id))!.status).toBe("DRAFT");
    await requestRetrieval(db, client, id, { brief: {}, days: 5 });
    await declineRequest(db, id, "We can't source papers in that language yet.");
    expect((await getReview(db, client, id))!.status).toBe("DRAFT");
    expect((await notes(client)).some((n) => n.body?.includes("that language"))).toBe(true);
  });

  it("runs from request to assignment, delivery, client review and payment release", async () => {
    const id = await createReview(db, client, { title: "Rainfall and adaptation", researchQuestion: "How do farmers adapt to rainfall variability?" });
    await requestRetrieval(db, client, id, { brief: { papersWanted: 10, years: "2010 to 2025", include: "Empirical studies" }, days: 7 });
    const order = await assignRetriever(db, id, { expertUserId: expert, priceMinor: 25_000, days: 7, note: "Include FAO reports" });
    expect(order.totalMinor).toBe(25_000);
    expect(JSON.stringify(order.requirements)).toContain("How do farmers adapt to rainfall variability?");
    expect(JSON.stringify(order.requirements)).toContain("Papers wanted: 10");
    expect(await reviewForOrder(db, order.id)).toBe(id);
    expect((await notes(client)).some((n) => n.link === `/orders/${order.id}`)).toBe(true);
    await expect(cancelRequest(db, client, id)).resolves.toBeUndefined(); // can withdraw before paying…
    await requestRetrieval(db, client, id, { brief: {}, days: 7 });
    const order2 = await assignRetriever(db, id, { expertUserId: expert, priceMinor: 25_000, days: 7 });
    const asExpert = await getReview(db, expert, id);
    expect(asExpert).toMatchObject({ role: "expert", orderId: order2.id });

    await addDoi(db, expert, id, "10.1000/aaa", { note: "Core study", crossref });
    await addDoi(db, expert, id, "10.1000/bbb", { note: "Contrasting case", crossref });
    // nothing is filled in for the expert: they type every paper's details after reading it
    expect((await listPapers(db, id))[0].meta).toEqual({ doi: "10.1000/aaa" });
    await expect(submitRetrieval(db, expert, id, "")).rejects.toThrow(/Fill in the record for P01, P02/);
    await expect(record(id, 1, { meta: { doi: "10.1000/aaa" } })).rejects.toThrow(/title, at least one author and the year/);
    await expect(record(id, 1, { summary: "Good paper." })).rejects.toThrow(/at least 25 words/);
    await expect(record(id, 1, { confirmed: false })).rejects.toThrow(/Confirm that you have read/);
    expect((await record(id, 1)).mismatches).toEqual([]);
    // Crossref is only a cross-check: a different year is flagged, not overwritten
    expect((await record(id, 2, { meta: { title: "Paper 10.1000/bbb", authors: [{ family: "Mensah" }], year: 2015, doi: "10.1000/bbb" } })).mismatches).toEqual(["Year: Crossref has 2020"]);
    const p2 = (await listPapers(db, id))[1];
    expect(p2.meta.year).toBe(2015);
    expect(p2.summary).toBe(summary);
    await expect(submitRetrieval(db, expert, id, "")).rejects.toThrow(/search log/);
    await saveSearchLog(db, expert, id, { databases: ["Scopus", "AJOL"], searchStrings: "rainfall AND adaptation", identified: 120, duplicates: 20, screened: 100, excludedScreening: 80, fullText: 20, excludedFullText: 18, included: 2 });
    await expect(submitRetrieval(db, expert, id, "")).rejects.toThrow(/escrow/);
    const [m] = await db.select().from(schema.milestones).where(eq(schema.milestones.orderId, order2.id));
    await fundMilestone(db, { milestoneId: m.id, amountMinor: 25_000, currency: "GHS", reference: "ps_1" });
    await submitRetrieval(db, expert, id, "Two strong papers.");
    await expect(cancelRequest(db, client, id)).rejects.toThrow(/can't be withdrawn/); // …not after
    expect((await getReview(db, client, id))!.status).toBe("REVIEWING");
    const [del] = await db.select().from(schema.milestones).where(eq(schema.milestones.id, m.id));
    expect(del.status).toBe("DELIVERED");
    await expect(addDoi(db, expert, id, "10.1000/ccc", { crossref })).rejects.toThrow(/already been delivered/);

    // the client rejects one and asks for a replacement
    let papers = await listPapers(db, id);
    await decidePaper(db, client, papers[0].id, true);
    await decidePaper(db, client, papers[1].id, false, "Wrong region");
    await askReplacements(db, client, id, "Please find one from coastal Ghana");
    expect((await getReview(db, client, id))!.status).toBe("RETRIEVAL");
    await addDoi(db, expert, id, "10.1000/ccc", { note: "Coastal Volta study", crossref });
    await expect(submitRetrieval(db, expert, id, "Replacement added.")).rejects.toThrow(/P03/);
    await record(id, 3);
    await submitRetrieval(db, expert, id, "Replacement added.");

    await expect(acceptLiterature(db, client, id)).rejects.toThrow(/every paper/);
    papers = await listPapers(db, id);
    await decidePaper(db, client, papers.find((p) => p.status === "PENDING")!.id, true);
    await acceptLiterature(db, client, id);
    const done = (await getReview(db, client, id))!;
    expect(done.status).toBe("ANALYSIS");
    const [paid] = await db.select().from(schema.milestones).where(eq(schema.milestones.id, m.id));
    expect(paid.status).toBe("APPROVED");
    expect((await listPapers(db, id, { status: "ACCEPTED" })).map((p) => p.meta.doi)).toEqual(["10.1000/aaa", "10.1000/ccc"]);
    expect(methodsParagraph(done.searchLog as never, 2)).toContain("The search identified 120 records; after removing 20 duplicates, 100 titles and abstracts were screened");
  });
});
