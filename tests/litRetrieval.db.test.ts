import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { fundMilestone } from "@/server/escrow";
import { hireProposal, submitProposal } from "@/server/jobs";
import { addDoi, createReview, decidePaper, getReview, listPapers } from "@/server/lit";
import { acceptLiterature, askReplacements, methodsParagraph, requestRetrieval, reviewForOrder, saveSearchLog, submitRetrieval } from "@/server/litRetrieval";
import { approveApplication, submitApplication } from "@/server/vetting";

let db: DB;
let client: string, expert: string;
const crossref = async (g: { doi?: string }) => ({ meta: { title: `Paper ${g.doi}`, authors: [{ family: "Mensah" }], year: 2020, doi: g.doi }, verify: { checked: true, found: true } });

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [c] = await d.insert(schema.users).values({ email: "akosua@example.com", name: "Akosua" }).returning();
  const [e] = await d.insert(schema.users).values({ email: "ama@example.com", name: "Ama" }).returning();
  client = c.id;
  expert = e.id;
  const app = await submitApplication(db, expert, { qualification: "PhD", fields: ["Sociology"], experienceYears: 5, pitch: "p".repeat(90), cvUrl: "https://x.org/cv" });
  await approveApplication(db, { applicationId: app.id });
});

describe("literature retrieval by an expert", () => {
  it("runs from brief to job, hire, delivery, client review and payment release", async () => {
    const id = await createReview(db, client, { title: "Rainfall and adaptation", researchQuestion: "How do farmers adapt to rainfall variability?" });
    const jobId = await requestRetrieval(db, client, id, { brief: { papersWanted: 10, years: "2010 to 2025", include: "Empirical studies" }, budgetMin: 20_000, budgetMax: 30_000, days: 7 });
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(job.description).toContain("How do farmers adapt to rainfall variability?");
    expect(job.description).toContain("Papers wanted: 10");
    expect((await getReview(db, client, id))!.status).toBe("RETRIEVAL");
    expect(await getReview(db, expert, id)).toBeNull(); // not hired yet

    const { proposal } = await submitProposal(db, { jobId, expertUserId: expert, pitch: "I search Scopus, Web of Science and AJOL for climate adaptation literature every week.", milestonePlan: [{ title: "Literature", amountMinor: 25_000, dueInDays: 5 }] }) as unknown as { proposal: { id: string } };
    const pid = proposal?.id ?? (await db.select().from(schema.proposals))[0].id;
    const order = await hireProposal(db, { proposalId: pid, clientId: client });
    expect(await reviewForOrder(db, order.id)).toBeNull(); // linked on first visit
    const asExpert = await getReview(db, expert, id);
    expect(asExpert).toMatchObject({ role: "expert", orderId: order.id });
    expect(await reviewForOrder(db, order.id)).toBe(id);

    await addDoi(db, expert, id, "10.1000/aaa", { note: "Core study", crossref });
    await addDoi(db, expert, id, "10.1000/bbb", { note: "Contrasting case", crossref });
    await expect(submitRetrieval(db, expert, id, "")).rejects.toThrow(/search log/);
    await saveSearchLog(db, expert, id, { databases: ["Scopus", "AJOL"], searchStrings: "rainfall AND adaptation", identified: 120, duplicates: 20, screened: 100, excludedScreening: 80, fullText: 20, excludedFullText: 18, included: 2 });
    await expect(submitRetrieval(db, expert, id, "")).rejects.toThrow(/escrow/);
    const [m] = await db.select().from(schema.milestones).where(eq(schema.milestones.orderId, order.id));
    await fundMilestone(db, { milestoneId: m.id, amountMinor: 25_000, currency: "GHS", reference: "ps_1" });
    await submitRetrieval(db, expert, id, "Two strong papers.");
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
