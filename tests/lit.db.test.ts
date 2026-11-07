import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { inText, reference } from "@/lib/cite";
import { addDoi, addPdf, createReview, decidePaper, deleteReview, getAnalysisState, getReview, guessMeta, listPapers, paperFile } from "@/server/lit";
import { type WriteState, criticalCheck, editParagraph, makeOutline, readPapers, runSynthesis, writeSection } from "@/server/litAnalysis";
import { litExport } from "@/server/litExport";

const PDF = new Uint8Array(readFileSync("tests/fixtures/paper.pdf"));
let db: DB;
let owner: string;
let other: string;

const crossref = vi.fn(async (g: { doi?: string; title?: string }) => ({
  meta: { title: "Rainfall variability and farmer adaptation in Northern Ghana", authors: [{ family: "Mensah", given: "Ama" }, { family: "Owusu", given: "Kofi" }], year: 2021, journal: "Journal of Rural Studies", volume: "82", pages: "10-20", doi: g.doi ?? "10.1016/j.jrurstud.2021.01.002" },
  verify: { checked: true, found: true, source: "doi" as const, titleMatch: true, retracted: false },
}));

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "abena@example.com", name: "Abena" }).returning();
  const [o] = await d.insert(schema.users).values({ email: "kojo@example.com", name: "Kojo" }).returning();
  owner = u.id;
  other = o.id;
  process.env.ANTHROPIC_API_KEY = "test";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

/** A fake Claude that answers each stage, quoting the real PDF text where quotes are asked for. */
function fakeClaude(prompts: string[]) {
  return vi.fn(async (_u: string, init: { body: string }) => {
    const prompt = (JSON.parse(init.body) as { messages: { content: string }[] }).messages[0].content;
    prompts.push(prompt);
    let out: unknown;
    if (prompt.includes("fill in a reading card")) {
      out = {
        summary: { introduction: "Asks how farmers respond to rainfall change.", methods: "Interviews with 40 farmers.", findings: "Later rains; adaptation varies.", conclusions: "Poorer households struggle to adapt." },
        aim: { text: "How farmers perceive and respond to rainfall variability", quote: "examines how smallholder farmers in Northern Ghana perceive and respond to rainfall variability" },
        theory: { text: "Not reported" },
        context: { text: "Upper West, Ghana", quote: "40 smallholder farmers in two districts of the Upper West", country: "Ghana" },
        design: { type: "qualitative", text: "Semi-structured interviews", quote: "We conducted semi-structured interviews with 40 smallholder farmers" },
        sample: { text: "40 farmers" },
        findings: [
          { text: "Rains start later", quote: "the rains now start in late May rather than April" },
          { text: "Access shapes adaptation", quote: "Adaptation was shaped by access to credit, land and labour" },
          { text: "Invented", quote: "farmers said they would all move to the city next year" },
        ],
        conclusions: { text: "Poorer households lacked resources", quote: "poorer households lacked the resources to adapt" },
        limitations: [{ text: "Small sample" }],
        keyTerms: [{ term: "adaptation", text: "Changes farmers make in response to climate", quote: "Most adapted by planting drought-tolerant maize" }],
        keywords: ["climate change", "adaptation"],
        quality: { rating: "moderate", notes: "Small qualitative sample." },
        bibliographic: { title: "Rainfall variability and farmer adaptation in Northern Ghana", authors: [{ family: "Mensah", given: "Ama" }, { family: "Owusu", given: "Kofi" }], year: 2021, journal: "Journal of Rural Studies" },
      };
    } else if (prompt.includes("Synthesise them")) {
      out = {
        concepts: [{ id: "C1", name: "Rainfall change", description: "Perceived shifts" }],
        matrix: { P01: { C1: "Later onset" }, P02: { C1: "Later onset" }, P99: { C1: "ghost" } },
        themes: [{ name: "Unequal capacity to adapt", claim: "Adaptation depends on resources.", description: "…", papers: [{ p: "P01", stance: "supports", point: "Credit and land" }, { p: "P02", stance: "supports", point: "Same" }, { p: "P99", stance: "supports", point: "ghost" }] }],
        agreements: [{ statement: "Rains come later", papers: ["P01", "P02"] }],
        contradictions: [{ statement: "Role of gender", sides: [{ papers: ["P01"], position: "Women constrained" }, { papers: ["P02"], position: "No difference" }], explanation: "Different districts." }],
        gaps: [{ gap: "No coastal studies", why: "Matters for comparison", papers: ["P01"] }],
        glossary: [{ term: "adaptation", definitions: [{ p: "P01", definition: "Changes in practice" }] }],
      };
    } else if (prompt.includes("Plan a CRITICAL")) {
      out = { sections: [{ heading: "Introduction", purpose: "Scope", points: ["scope"], themes: [], words: 300 }, { heading: "Unequal capacity to adapt", purpose: "Resources shape adaptation", points: ["credit", "land"], themes: ["T1"], words: 600 }] };
    } else {
      out = {
        paragraphs: [
          {
            sentences: [
              { text: "Capacity to adapt to changing rainfall is unevenly distributed.", sources: [], evidence: [] },
              { text: "Access to credit, land and labour shapes which households adapt.", sources: ["P01", "P02"], evidence: ["P01-F2"] },
              { text: "Mensah (2021) found that rains start later.", sources: ["P01"], evidence: ["P99-F1"] },
            ],
          },
        ],
      };
    }
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }], stop_reason: "end_turn" }), { status: 200 });
  });
}

describe("papers", () => {
  it("reads a PDF, checks it with Crossref, and keeps it private to the owner", async () => {
    const id = await createReview(db, owner, { title: "Rainfall", researchQuestion: "How do farmers adapt to rainfall variability?" });
    const r = await addPdf(db, owner, id, PDF, "mensah.pdf", { crossref });
    expect(r.textFound).toBe(true);
    expect(crossref).toHaveBeenCalledWith(expect.objectContaining({ doi: "10.1016/j.jrurstud.2021.01.002" }));
    const [p] = await listPapers(db, id);
    expect(p).toMatchObject({ n: 1, status: "ACCEPTED", source: "CLIENT", pages: 2 });
    expect(p.meta.authors?.[0].family).toBe("Mensah");
    expect(p.verify?.found).toBe(true);
    expect((await paperFile(db, owner, p.id))!.bytes.length).toBe(PDF.length);
    await expect(paperFile(db, other, p.id)).rejects.toThrow(/not found/);
    expect(await getReview(db, other, id)).toBeNull();
    await expect(addPdf(db, owner, id, new TextEncoder().encode("hello"), "x.pdf", { crossref })).rejects.toThrow(/isn't a PDF/);
  });

  it("guesses details from the first page when the PDF has no metadata", () => {
    const g = guessMeta(["Some Journal Vol. 3\nUrban water access and gender in Accra informal settlements\nA. Boateng 2019\ndoi: 10.1234/ABC.5."], {});
    expect(g).toMatchObject({ doi: "10.1234/abc.5", title: "Urban water access and gender in Accra informal settlements", year: 2019 });
  });

  it("puts expert-delivered papers in front of the client to accept or reject", async () => {
    const id = await createReview(db, owner, { title: "R", researchQuestion: "How do farmers adapt to rainfall variability?" });
    await db.update(schema.litReviews).set({ status: "RETRIEVAL", expertUserId: other });
    const r = await addDoi(db, other, id, "https://doi.org/10.1016/j.jrurstud.2021.01.002", { crossref, note: "Core study" });
    let [p] = await listPapers(db, id);
    expect(p).toMatchObject({ status: "PENDING", source: "EXPERT", note: "Core study" });
    await expect(decidePaper(db, other, p.id, true)).rejects.toThrow(/owner/);
    await expect(decidePaper(db, owner, p.id, false)).rejects.toThrow(/why/);
    await decidePaper(db, owner, p.id, false, "Off topic");
    [p] = await listPapers(db, id);
    expect(p).toMatchObject({ status: "REJECTED", rejectReason: "Off topic" });
    expect(r.n).toBe(1);
    await expect(deleteReview(db, owner, id)).rejects.toThrow(/expert/);
  });
});

describe("analysis", () => {
  it("reads, synthesises, outlines and writes with every sentence checked", async () => {
    const id = await createReview(db, owner, { title: "Rainfall", researchQuestion: "How do farmers adapt to rainfall variability?", style: "apa" });
    await addPdf(db, owner, id, PDF, "a.pdf", { crossref });
    await addPdf(db, owner, id, PDF, "b.pdf", { crossref: async () => ({ meta: { title: "Second", authors: [{ family: "Boateng", given: "Yaw" }], year: 2019, journal: "Climate", doi: "10.1/x" }, verify: { checked: true, found: true } }) });
    const prompts: string[] = [];
    vi.stubGlobal("fetch", fakeClaude(prompts));

    let r = await readPapers(db, owner, id, { batch: 1 });
    expect(r).toMatchObject({ done: 1, total: 2, finished: false });
    r = await readPapers(db, owner, id, { batch: 1 });
    expect(r.finished).toBe(true);
    const [p1] = await listPapers(db, id);
    const card = p1.card as { findings: { text: string; verified: boolean; page?: number }[]; design: { type: string; verified: boolean } };
    expect(card.findings[0]).toMatchObject({ verified: true, page: 2 });
    expect(card.findings[2].verified).toBe(false); // an invented quote is caught
    expect(card.design).toMatchObject({ type: "qualitative", verified: true });

    const syn = await runSynthesis(db, owner, id);
    expect(syn.themes[0].papers.map((x) => x.p)).toEqual(["P01", "P02"]); // P99 doesn't exist
    expect(syn.matrix.P99).toBeUndefined();
    expect(syn.contradictions[0].sides).toHaveLength(2);

    const outline = await makeOutline(db, owner, id, 3000);
    expect(outline.map((s) => s.heading)).toEqual(["Introduction", "Unequal capacity to adapt"]);
    const paras = await writeSection(db, owner, id, "S2");
    expect(paras[0].sentences.map((s) => s.status)).toEqual(["analysis", "verified", "unverified"]);
    expect(prompts.at(-1)).toContain("Never start a sentence with an author");

    const state = await getAnalysisState<WriteState>(db, id);
    const warnings = criticalCheck(state, await listPapers(db, id));
    expect(warnings.map((w) => w.kind)).toEqual(expect.arrayContaining(["author-led", "unverified"]));

    const review = (await getReview(db, owner, id))!;
    const doc = await litExport(db, review, "review");
    expect(doc!.name).toBe("literature-review.docx");
    expect(String.fromCharCode(...(doc!.body as Uint8Array).slice(0, 2))).toBe("PK");
    expect((await litExport(db, review, "bibliography"))!.name).toBe("annotated-bibliography.docx");
    expect(String((await litExport(db, review, "spreadsheet"))!.body)).toContain("https://doi.org/10.1016/j.jrurstud.2021.01.002");
    expect(String((await litExport(db, review, "matrix"))!.body)).toContain("Later onset");
    expect(String((await litExport(db, review, "ris"))!.body)).toContain("AU  - Mensah, Ama");
    expect(String((await litExport(db, review, "bibtex"))!.body)).toContain("@article{mensah2021_1");

    await editParagraph(db, owner, id, "S2", 0, "My own words.");
    expect((await getAnalysisState<WriteState>(db, id)).sections!.S2[0].edited).toBe("My own words.");
  });
});

describe("papers Crossref doesn't know", () => {
  it("take their authors from the paper itself when it is read", async () => {
    const id = await createReview(db, owner, { title: "R", researchQuestion: "How do farmers adapt to rainfall variability?" });
    await addPdf(db, owner, id, PDF, "thesis.pdf", { crossref: async () => ({ verify: { checked: true, found: false, message: "No matching record" } }) });
    expect((await listPapers(db, id))[0].meta.authors ?? []).toEqual([]);
    vi.stubGlobal("fetch", fakeClaude([]));
    await readPapers(db, owner, id);
    const [p] = await listPapers(db, id);
    expect(p.meta.authors?.map((a) => a.family)).toEqual(["Mensah", "Owusu"]);
    expect(p.meta.year).toBe(2021);
  });
});

describe("citations", () => {
  const m = { title: "Rainfall variability.", authors: [{ family: "Mensah", given: "Ama B." }, { family: "Owusu", given: "Kofi" }], year: 2021, journal: "Journal of Rural Studies", volume: "82", issue: "2", pages: "10-20", doi: "10.1/abc" };
  it("formats in-text citations and references in each style", () => {
    expect(inText([{ meta: m, n: 1 }, { meta: { ...m, authors: [{ family: "Boateng" }, { family: "A" }, { family: "B" }], year: 2019 }, n: 2 }], "apa")).toBe("(Mensah & Owusu, 2021; Boateng et al., 2019)");
    expect(inText([{ meta: m, n: 1 }], "harvard")).toBe("(Mensah and Owusu 2021)");
    expect(inText([{ meta: m, n: 1, ref: 3 }, { meta: m, n: 2, ref: 1 }], "vancouver")).toBe("[1, 3]");
    expect(reference(m, "apa")).toBe("Mensah, A. B., & Owusu, K. (2021). Rainfall variability. *Journal of Rural Studies*, *82*(2), 10-20. https://doi.org/10.1/abc");
    expect(reference(m, "vancouver", 1)).toBe("1. Mensah AB, Owusu K. Rainfall variability. Journal of Rural Studies. 2021;82(2):10-20. doi:10.1/abc");
    expect(reference(m, "mla")).toContain('"Rainfall variability." *Journal of Rural Studies*, vol. 82, no. 2, 2021, pp. 10-20.');
  });
});
