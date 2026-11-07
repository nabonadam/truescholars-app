/**
 * Literature Review: reviews, their papers, PDF reading and verification.
 * Papers come from the client (uploads) or from an expert hired through the marketplace (they arrive as
 * PENDING and the client accepts or rejects each one). Only ACCEPTED papers go into the analysis.
 * Every PDF is read page by page (so quotes can be checked and located), and its details are checked
 * against Crossref: does the DOI exist, does the title match, has the paper been retracted?
 */

import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { litAnalyses, litPaperText, litPapers, litReviews } from "@/db/schema";
import { type Author, type PaperMeta, type Style, isStyle } from "@/lib/cite";
import { deleteAudio, deleteAudioPrefix, getAudio, putAudio } from "./qualStorage";

export class LitError extends Error {}

export const MAX_PDF_BYTES = 40 * 1024 * 1024;
export const MAX_PAPERS = 120;

export type Brief = {
  purpose?: string; // thesis chapter | journal article | proposal | dissertation | coursework | other
  discipline?: string;
  papersWanted?: number;
  years?: string; // e.g. "2010–2025"
  regions?: string;
  languages?: string;
  include?: string; // study types / criteria to include
  exclude?: string;
  deadline?: string;
  notes?: string;
};

export type Verify = {
  checked: boolean;
  found: boolean; // Crossref knows this work
  titleMatch?: boolean; // the PDF's first page matches the Crossref title
  retracted?: boolean;
  source?: "doi" | "title" | "none";
  message?: string;
  byHand?: boolean; // details typed by the expert; Crossref only cross-checked them
  mismatches?: string[]; // where the expert's details differ from Crossref's
};

export type ReviewRow = typeof litReviews.$inferSelect;
export type PaperRow = typeof litPapers.$inferSelect;

// ───────── reviews ─────────

/** A title from the research question: whole words, at most about 90 characters. */
export function titleFrom(q: string) {
  const t = q.trim().replace(/\s+/g, " ");
  if (t.length <= 90) return t;
  return t.slice(0, 90).replace(/\s+\S*$/, "").replace(/[\s,;:–-]+$/, "") + "…";
}

export async function createReview(db: DB, ownerId: string, p: { title: string; researchQuestion: string; brief?: Brief; style?: string }) {
  const title = p.title.trim().slice(0, 200) || titleFrom(p.researchQuestion) || "Untitled review";
  const rq = p.researchQuestion.trim().slice(0, 1500);
  if (rq.length < 10) throw new LitError("Write your research question: the whole review is organised around it.");
  const [r] = await db
    .insert(litReviews)
    .values({ ownerId, title, researchQuestion: rq, brief: cleanBrief(p.brief ?? {}), style: p.style && isStyle(p.style) ? p.style : "apa" })
    .returning({ id: litReviews.id });
  return r.id;
}

export function cleanBrief(b: Brief): Brief {
  const s = (v: unknown, n = 400) => (typeof v === "string" ? v.trim().slice(0, n) : undefined) || undefined;
  const pw = Number(b.papersWanted);
  return {
    purpose: s(b.purpose, 80),
    discipline: s(b.discipline, 120),
    papersWanted: Number.isFinite(pw) && pw > 0 ? Math.min(200, Math.round(pw)) : undefined,
    years: s(b.years, 60),
    regions: s(b.regions, 200),
    languages: s(b.languages, 120),
    include: s(b.include, 1200),
    exclude: s(b.exclude, 1200),
    deadline: s(b.deadline, 40),
    notes: s(b.notes, 2000),
  };
}

export async function listReviews(db: DB, ownerId: string) {
  const papers = sql<number>`(select count(*)::int from ${litPapers} p where p.review_id = ${litReviews.id} and p.status = 'ACCEPTED')`;
  return db
    .select({ id: litReviews.id, title: litReviews.title, status: litReviews.status, updatedAt: litReviews.updatedAt, papers })
    .from(litReviews)
    .where(eq(litReviews.ownerId, ownerId))
    .orderBy(desc(litReviews.updatedAt));
}

/** The review if this user may see it: its owner, or the expert hired to find its literature. */
export async function getReview(db: DB, userId: string, id: string): Promise<(ReviewRow & { role: "owner" | "expert" }) | null> {
  const [row] = await db.select().from(litReviews).where(eq(litReviews.id, id));
  if (!row) return null;
  // once the client hires an expert on the retrieval job, the expert gets the workspace; approvals in the order room carry over
  const { linkHire, syncWithOrder } = await import("./litRetrieval");
  const r = await syncWithOrder(db, await linkHire(db, row));
  if (r.ownerId === userId) return { ...r, role: "owner" };
  if (r.expertUserId && r.expertUserId === userId) return { ...r, role: "expert" };
  return null;
}

export async function mustOwn(db: DB, userId: string, id: string) {
  const r = await getReview(db, userId, id);
  if (!r || r.role !== "owner") throw new LitError("Review not found.");
  return r;
}

export async function updateReview(db: DB, ownerId: string, id: string, p: { title?: string; researchQuestion?: string; brief?: Brief; style?: string }) {
  await mustOwn(db, ownerId, id);
  const set: Partial<typeof litReviews.$inferInsert> = {};
  if (p.title !== undefined) set.title = p.title.trim().slice(0, 200) || "Untitled review";
  if (p.researchQuestion !== undefined) {
    const rq = p.researchQuestion.trim().slice(0, 1500);
    if (rq.length < 10) throw new LitError("Write your research question: the whole review is organised around it.");
    set.researchQuestion = rq;
  }
  if (p.brief) set.brief = cleanBrief(p.brief);
  if (p.style !== undefined) set.style = isStyle(p.style) ? (p.style as Style) : "apa";
  await db.update(litReviews).set(set).where(eq(litReviews.id, id));
}

export async function deleteReview(db: DB, ownerId: string, id: string) {
  const r = await mustOwn(db, ownerId, id);
  if (r.status === "RETRIEVAL") throw new LitError("An expert is finding papers for this review. Wait until they deliver, or settle the order first.");
  await deleteAudioPrefix(db, `lit/${id}/`);
  await db.delete(litReviews).where(eq(litReviews.id, id));
}

export async function touch(db: DB, id: string) {
  await db.update(litReviews).set({ updatedAt: new Date() }).where(eq(litReviews.id, id));
}

// ───────── papers ─────────

export async function listPapers(db: DB, reviewId: string, opts: { status?: "ACCEPTED" | "PENDING" } = {}) {
  const rows = await db
    .select()
    .from(litPapers)
    .where(opts.status ? and(eq(litPapers.reviewId, reviewId), eq(litPapers.status, opts.status)) : eq(litPapers.reviewId, reviewId))
    .orderBy(asc(litPapers.n));
  return rows.map((p) => ({ ...p, meta: (p.meta ?? {}) as PaperMeta, verify: (p.verify ?? null) as Verify | null }));
}
export type Paper = Awaited<ReturnType<typeof listPapers>>[number];

export async function paperPages(db: DB, paperId: string): Promise<string[]> {
  const [t] = await db.select().from(litPaperText).where(eq(litPaperText.paperId, paperId));
  return (t?.pages as string[]) ?? [];
}

async function nextNumber(db: DB, reviewId: string) {
  const [r] = await db.select({ m: max(litPapers.n) }).from(litPapers).where(eq(litPapers.reviewId, reviewId));
  return (r?.m ?? 0) + 1;
}

/** Who may add papers: the owner any time; the hired expert while the retrieval job is open. */
async function canAddPapers(db: DB, userId: string, reviewId: string): Promise<{ r: ReviewRow; source: "CLIENT" | "EXPERT" }> {
  const r = await getReview(db, userId, reviewId);
  if (!r) throw new LitError("Review not found.");
  if (r.role === "expert") {
    if (r.status !== "RETRIEVAL") throw new LitError("This literature has already been delivered.");
    return { r, source: "EXPERT" };
  }
  return { r, source: "CLIENT" };
}

const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

/** Adds a PDF: stores it, reads every page, finds its details and checks them against Crossref. */
export async function addPdf(db: DB, userId: string, reviewId: string, bytes: Uint8Array, fileName: string, opts: { note?: string; crossref?: typeof crossrefLookup } = {}) {
  const { source } = await canAddPapers(db, userId, reviewId);
  if (!bytes.length) throw new LitError("That file is empty.");
  if (bytes.length > MAX_PDF_BYTES) throw new LitError("That PDF is larger than 40 MB.");
  if (!isPdf(bytes)) throw new LitError(`${fileName || "That file"} isn't a PDF.`);
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(litPapers).where(eq(litPapers.reviewId, reviewId));
  if (c >= MAX_PAPERS) throw new LitError(`A review can hold up to ${MAX_PAPERS} papers.`);

  const { pages, info } = await readPdf(bytes);
  // An expert enters every paper's details by hand after reading it, so nothing is filled in for them.
  const guess = source === "EXPERT" ? {} : guessMeta(pages, info);
  const check = source === "EXPERT" ? { meta: undefined, verify: null } : await (opts.crossref ?? crossrefLookup)(guess);
  const meta: PaperMeta = { ...guess, ...(check.meta ?? {}), abstract: check.meta?.abstract || (guess as PaperMeta).abstract };
  const n = await nextNumber(db, reviewId);
  const [p] = await db
    .insert(litPapers)
    .values({
      reviewId,
      n,
      source,
      status: source === "EXPERT" ? "PENDING" : "ACCEPTED",
      fileName: fileName.slice(0, 200) || `${n}.pdf`,
      sizeBytes: bytes.length,
      pages: pages.length,
      meta,
      verify: check.verify,
      note: opts.note?.trim().slice(0, 1000) || null,
      addedBy: userId,
    })
    .returning({ id: litPapers.id });
  const key = `lit/${reviewId}/${p.id}.pdf`;
  await putAudio(db, key, bytes, "application/pdf");
  await db.insert(litPaperText).values({ paperId: p.id, pages });
  await db.update(litPapers).set({ fileKey: key }).where(eq(litPapers.id, p.id));
  await touch(db, reviewId);
  return { id: p.id, n, textFound: pages.join("").trim().length > 200 };
}

/** A paper known only by its DOI (for example a paywalled article): the client attaches their own PDF later. */
export async function addDoi(db: DB, userId: string, reviewId: string, doi: string, opts: { note?: string; crossref?: typeof crossrefLookup } = {}) {
  const { source } = await canAddPapers(db, userId, reviewId);
  const d = cleanDoi(doi);
  if (!d) throw new LitError("That doesn't look like a DOI (it should start with 10.).");
  const check = source === "EXPERT" ? { meta: undefined, verify: null } : await (opts.crossref ?? crossrefLookup)({ doi: d });
  const n = await nextNumber(db, reviewId);
  const [p] = await db
    .insert(litPapers)
    .values({ reviewId, n, source, status: source === "EXPERT" ? "PENDING" : "ACCEPTED", meta: { doi: d, ...(check.meta ?? {}) }, verify: check.verify, note: opts.note?.trim().slice(0, 1000) || null, addedBy: userId })
    .returning({ id: litPapers.id });
  await touch(db, reviewId);
  return { id: p.id, n };
}

/** Attaches a PDF to a paper that has none yet (a DOI-only entry), keeping its number and status. */
export async function attachPdf(db: DB, userId: string, paperId: string, bytes: Uint8Array) {
  const [p] = await db.select().from(litPapers).where(eq(litPapers.id, paperId));
  if (!p) throw new LitError("Paper not found.");
  const r = await getReview(db, userId, p.reviewId);
  if (!r) throw new LitError("Paper not found.");
  if (!isPdf(bytes)) throw new LitError("That file isn't a PDF.");
  if (bytes.length > MAX_PDF_BYTES) throw new LitError("That PDF is larger than 40 MB.");
  const { pages } = await readPdf(bytes);
  const key = `lit/${p.reviewId}/${p.id}.pdf`;
  await putAudio(db, key, bytes, "application/pdf");
  await db.insert(litPaperText).values({ paperId: p.id, pages }).onConflictDoUpdate({ target: litPaperText.paperId, set: { pages } });
  await db.update(litPapers).set({ fileKey: key, sizeBytes: bytes.length, pages: pages.length, card: null, cardStatus: "none" }).where(eq(litPapers.id, p.id));
}

async function ownPaper(db: DB, userId: string, paperId: string) {
  const [p] = await db.select().from(litPapers).where(eq(litPapers.id, paperId));
  if (!p) throw new LitError("Paper not found.");
  const r = await getReview(db, userId, p.reviewId);
  if (!r) throw new LitError("Paper not found.");
  return { p, r };
}

function cleanMeta(old: PaperMeta, meta: PaperMeta): PaperMeta {
  const s = (v: unknown, n = 400) => (typeof v === "string" ? v.trim().slice(0, n) : undefined) || undefined;
  const authors = (meta.authors ?? []).map((a) => ({ family: s(a.family, 80) ?? "", given: s(a.given, 80) })).filter((a) => a.family).slice(0, 60);
  const year = Number(meta.year);
  return {
    ...old,
    title: s(meta.title, 500),
    authors,
    year: Number.isInteger(year) && year > 1500 && year < 2100 ? year : null,
    journal: s(meta.journal, 300),
    volume: s(meta.volume, 20),
    issue: s(meta.issue, 20),
    pages: s(meta.pages, 30),
    doi: cleanDoi(meta.doi ?? "") ?? undefined,
  };
}

/** Corrects a paper's details (title, authors, year…). */
export async function editPaperMeta(db: DB, userId: string, paperId: string, meta: PaperMeta) {
  const { p, r } = await ownPaper(db, userId, paperId);
  if (r.role === "expert") throw new LitError("Use the paper's record form to change its details.");
  await db.update(litPapers).set({ meta: cleanMeta(p.meta as PaperMeta, meta) }).where(eq(litPapers.id, paperId));
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/**
 * The expert's record of a paper, typed by hand after reading it: its details, a summary in their own
 * words, why it fits the research question, and their confirmation. Crossref is then used only to
 * cross-check what they typed; differences are flagged for them to look at, never overwritten.
 */
export async function recordPaper(
  db: DB,
  expertId: string,
  paperId: string,
  input: { meta: PaperMeta; summary: string; note: string; confirmed: boolean },
  lookup = crossrefLookup,
) {
  const { p, r } = await ownPaper(db, expertId, paperId);
  if (r.role !== "expert") throw new LitError("Only the expert records papers this way.");
  if (p.status !== "PENDING" || r.status !== "RETRIEVAL") throw new LitError("This paper has already been delivered.");
  const meta = cleanMeta(p.meta as PaperMeta, input.meta);
  const missing = [!meta.title && "the title", !meta.authors?.length && "at least one author", !meta.year && "the year"].filter(Boolean);
  if (missing.length) throw new LitError(`Add ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}, exactly as they appear in the paper.`);
  const summary = input.summary.trim().slice(0, 3000);
  const note = input.note.trim().slice(0, 1000);
  if (words(summary) < 25) throw new LitError("Write a summary of at least 25 words: what the study did and what it found.");
  if (words(note) < 8) throw new LitError("Say in a sentence or two why this paper fits the research question.");
  if (!input.confirmed) throw new LitError("Confirm that you have read the paper and that it fits the research question.");

  const check = await lookup({ doi: meta.doi, title: meta.title });
  const mismatches: string[] = [];
  const c = check.meta;
  if (c) {
    if (c.title && similar(meta.title, c.title) < 0.6) mismatches.push(`Title: Crossref has “${c.title}”`);
    if (c.year && meta.year && Math.abs(c.year - meta.year) > 1) mismatches.push(`Year: Crossref has ${c.year}`);
    const fam = (x?: string) => (x ?? "").normalize("NFKD").replace(/[^\p{L}]/gu, "").toLowerCase();
    if (c.authors?.length && meta.authors?.length && fam(c.authors[0].family) !== fam(meta.authors[0].family)) mismatches.push(`First author: Crossref has ${c.authors[0].family}`);
  }
  // fill only what the expert left empty (journal, volume…), never what they typed
  const filled: PaperMeta = { ...meta };
  if (c) for (const k of ["journal", "volume", "issue", "pages", "publisher", "type", "abstract"] as const) if (!filled[k] && c[k]) (filled as Record<string, unknown>)[k] = c[k];
  await db
    .update(litPapers)
    .set({ meta: filled, summary, note, confirmedAt: new Date(), verify: { ...check.verify, byHand: true, titleMatch: c ? mismatches.every((m) => !m.startsWith("Title")) : check.verify.titleMatch, mismatches } })
    .where(eq(litPapers.id, paperId));
  return { mismatches, found: check.verify.found };
}

export async function setNote(db: DB, userId: string, paperId: string, note: string) {
  const { p, r } = await ownPaper(db, userId, paperId);
  if (r.role === "expert" && p.status !== "PENDING") throw new LitError("This paper has already been reviewed by the client.");
  await db.update(litPapers).set({ note: note.trim().slice(0, 1000) || null }).where(eq(litPapers.id, paperId));
}

/** The client accepts or rejects a paper (rejected papers stay listed, with the reason, and leave the analysis). */
export async function decidePaper(db: DB, ownerId: string, paperId: string, accept: boolean, reason = "") {
  const { p, r } = await ownPaper(db, ownerId, paperId);
  if (r.role !== "owner") throw new LitError("Only the review's owner can accept or reject papers.");
  if (!accept && !reason.trim() && p.source === "EXPERT") throw new LitError("Say briefly why, so the expert can find a better paper.");
  await db.update(litPapers).set({ status: accept ? "ACCEPTED" : "REJECTED", rejectReason: accept ? null : reason.trim().slice(0, 500) }).where(eq(litPapers.id, paperId));
  await touch(db, p.reviewId);
}

export async function deletePaper(db: DB, userId: string, paperId: string) {
  const { p, r } = await ownPaper(db, userId, paperId);
  if (r.role === "expert" && p.status !== "PENDING") throw new LitError("This paper has already been reviewed by the client.");
  if (p.fileKey) await deleteAudio(db, p.fileKey).catch(() => null);
  await db.delete(litPapers).where(eq(litPapers.id, paperId));
}

/** The PDF, for the owner or the hired expert. */
export async function paperFile(db: DB, userId: string, paperId: string) {
  const { p } = await ownPaper(db, userId, paperId);
  if (!p.fileKey) return null;
  const f = await getAudio(db, p.fileKey);
  return f ? { ...f, name: p.fileName ?? `${p.n}.pdf` } : null;
}

export async function getAnalysisState<T>(db: DB, reviewId: string): Promise<T> {
  const [a] = await db.select().from(litAnalyses).where(eq(litAnalyses.reviewId, reviewId));
  return ((a?.state as T) ?? {}) as T;
}

export async function saveAnalysisState(db: DB, reviewId: string, state: unknown) {
  await db.insert(litAnalyses).values({ reviewId, state }).onConflictDoUpdate({ target: litAnalyses.reviewId, set: { state } });
  await touch(db, reviewId);
}

// ───────── reading PDFs ─────────

export async function readPdf(bytes: Uint8Array): Promise<{ pages: string[]; info: Record<string, unknown> }> {
  const { extractText, getDocumentProxy, getMeta } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new LitError("That PDF couldn't be opened. It may be damaged or password-protected.");
  }
  const { text } = await extractText(pdf, { mergePages: false });
  const info = ((await getMeta(pdf).catch(() => null))?.info ?? {}) as Record<string, unknown>;
  const pages = (Array.isArray(text) ? text : [text]).map((t) => String(t).replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, 60_000));
  return { pages: pages.slice(0, 400), info };
}

export const cleanDoi = (s: string): string | null => {
  const m = s.trim().match(/10\.\d{4,9}\/[^\s"<>]+/i);
  return m ? m[0].replace(/[).,;\]]+$/, "").toLowerCase() : null;
};

/** Best guesses from the PDF itself: DOI, title, year. Crossref then supplies the authoritative details. */
export function guessMeta(pages: string[], info: Record<string, unknown>): PaperMeta {
  const head = pages.slice(0, 2).join("\n");
  const doi = cleanDoi(head) ?? undefined;
  const infoTitle = typeof info.Title === "string" ? info.Title.trim() : "";
  const okTitle = infoTitle.length > 12 && !/^(microsoft|untitled|doi|pii|\d|layout|document)/i.test(infoTitle) && !/\.(docx?|pdf|indd)$/i.test(infoTitle);
  const lines = (pages[0] ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 20 && l.length < 250 && !/(journal|vol\.|volume|doi|http|©|copyright|received|accepted|issn|www\.)/i.test(l));
  const years = [...head.matchAll(/\b(19[5-9]\d|20[0-3]\d)\b/g)].map((m) => Number(m[1]));
  const abstract = head.match(/abstract[:.\s]*\n?([\s\S]{200,2500}?)(\n\s*(keywords|key words|introduction|1\.?\s+introduction)\b)/i)?.[1]?.replace(/\s+/g, " ").trim();
  return { doi, title: okTitle ? infoTitle : lines[0], year: years.length ? Math.max(...years.filter((y) => y <= new Date().getFullYear())) || null : null, abstract };
}

const normTitle = (s = "") => s.toLowerCase().normalize("NFKD").replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function similar(a = "", b = "") {
  const x = new Set(normTitle(a).split(" ").filter((w) => w.length > 2));
  const y = new Set(normTitle(b).split(" ").filter((w) => w.length > 2));
  if (!x.size || !y.size) return 0;
  let both = 0;
  x.forEach((w) => y.has(w) && both++);
  return both / Math.min(x.size, y.size);
}

type CrossrefWork = {
  DOI: string;
  title?: string[];
  author?: { family?: string; given?: string; name?: string }[];
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  type?: string;
  abstract?: string;
  publisher?: string;
  "updated-by"?: { type?: string }[];
  relation?: Record<string, unknown>;
};

const TYPES: Record<string, string> = { "journal-article": "journal-article", book: "book", "book-chapter": "book-chapter", monograph: "book", report: "report", dissertation: "thesis" };

export function fromCrossref(w: CrossrefWork): PaperMeta {
  const authors: Author[] = (w.author ?? []).map((a) => ({ family: a.family ?? a.name ?? "", given: a.given })).filter((a) => a.family);
  return {
    title: w.title?.[0]?.replace(/<[^>]+>/g, "").trim(),
    authors,
    year: w.issued?.["date-parts"]?.[0]?.[0] ?? null,
    journal: w["container-title"]?.[0],
    volume: w.volume,
    issue: w.issue,
    pages: w.page,
    doi: w.DOI?.toLowerCase(),
    type: TYPES[w.type ?? ""] ?? "other",
    publisher: w.publisher,
    abstract: w.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  };
}

const retracted = (w: CrossrefWork) => (w["updated-by"] ?? []).some((u) => /retract/i.test(u.type ?? "")) || /retract/i.test(JSON.stringify(w.relation ?? {}));

/** Checks a paper against Crossref by DOI, or by title when there is no DOI. Never throws: a failed check is reported. */
export async function crossrefLookup(guess: PaperMeta): Promise<{ meta?: PaperMeta; verify: Verify }> {
  const headers = { "User-Agent": `TheTrueScholars/1.0 (mailto:${process.env.CROSSREF_MAILTO || "hello@thetruescholars.com"})` };
  try {
    if (guess.doi) {
      const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(guess.doi)}`, { headers, signal: AbortSignal.timeout(15_000) });
      if (res.status === 404) return { verify: { checked: true, found: false, source: "doi", message: "This DOI isn't registered with Crossref. Check it carefully." } };
      if (res.ok) {
        const w = ((await res.json()) as { message: CrossrefWork }).message;
        const meta = fromCrossref(w);
        const titleMatch = guess.title ? similar(guess.title, meta.title) >= 0.6 : undefined;
        return { meta, verify: { checked: true, found: true, source: "doi", titleMatch, retracted: retracted(w) } };
      }
    }
    if (guess.title && guess.title.length > 15) {
      const res = await fetch(`https://api.crossref.org/works?rows=3&query.bibliographic=${encodeURIComponent(guess.title.slice(0, 300))}`, { headers, signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const items = ((await res.json()) as { message: { items: CrossrefWork[] } }).message.items ?? [];
        const best = items.find((w) => similar(guess.title, w.title?.[0]) >= 0.8);
        if (best) return { meta: fromCrossref(best), verify: { checked: true, found: true, source: "title", titleMatch: true, retracted: retracted(best) } };
        return { verify: { checked: true, found: false, source: "title", message: "No matching record found. It may be a thesis, report or book chapter; check its details." } };
      }
    }
    return { verify: { checked: !!guess.doi, found: false, source: "none", message: "No DOI or title found in the PDF. Add its details by hand." } };
  } catch {
    return { verify: { checked: false, found: false, message: "Crossref couldn't be reached. Try checking again later." } };
  }
}

/** Re-runs the Crossref check (for example after correcting the DOI or title). */
export async function recheckPaper(db: DB, userId: string, paperId: string, lookup = crossrefLookup) {
  const { p } = await ownPaper(db, userId, paperId);
  const meta = p.meta as PaperMeta;
  if (p.source === "EXPERT") throw new LitError("This paper's details were entered by hand by the expert, and are checked when they save the record.");
  const check = await lookup({ doi: meta.doi, title: meta.title });
  await db.update(litPapers).set({ meta: { ...meta, ...(check.meta ?? {}) }, verify: check.verify }).where(eq(litPapers.id, paperId));
  return check.verify;
}
