/** Expert vetting: applications, admin decisions, and the admin allow-list. */

import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { expertApplications, expertProfiles, files, users } from "@/db/schema";
import { notify } from "./notifications";

export class VettingError extends Error {}

export const QUALIFICATIONS = ["PhD", "PhD candidate", "Master's degree", "Bachelor's degree", "Professional certification"] as const;

export const EXPERT_FIELDS = [
  "Statistics & data analysis",
  "Academic editing & proofreading",
  "Research methodology",
  "Qualitative analysis",
  "Literature reviews",
  "Transcription",
  "Research tutoring",
] as const;

export interface ApplicationInput {
  qualification: string;
  fields: string[];
  experienceYears: number;
  pitch: string;
  cvUrl?: string | null;
  sampleUrl?: string | null;
  litRetriever?: boolean;
  cvFile?: File | null;
  sampleFile?: File | null;
  idFile?: File | null;
}

const DOC_TYPES = new Set(["pdf", "doc", "docx", "odt", "rtf", "txt", "xls", "xlsx", "csv", "ppt", "pptx", "png", "jpg", "jpeg", "webp", "zip", "dta", "do", "log", "sav", "r", "rmd", "py", "ipynb"]);
const ID_TYPES = new Set(["pdf", "png", "jpg", "jpeg", "webp", "heic"]);
const MAX_DOC = 10 * 1024 * 1024;

function checkDoc(f: File, label: string, types: Set<string>) {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (!types.has(ext)) throw new VettingError(`${label}: that file type isn't accepted. ${types === ID_TYPES ? "Use a photo (JPG, PNG) or a PDF." : "Use a PDF, Word document or similar."}`);
  if (f.size > MAX_DOC) throw new VettingError(`${label} is larger than 10 MB.`);
}

/** Stores one private document; only its owner and admins can download it (see getFileForUser). */
async function saveDoc(db: DB, userId: string, f: File) {
  const [row] = await db
    .insert(files)
    .values({ ownerId: userId, name: f.name.slice(0, 200), mimeType: f.type || "application/octet-stream", sizeBytes: f.size, data: Buffer.from(await f.arrayBuffer()) })
    .returning({ id: files.id });
  return row.id;
}

const real = (f: File | null | undefined) => (f && f.size > 0 ? f : null);

/** Emails in ADMIN_EMAILS (comma-separated) get the ADMIN role when they sign in. */
export function isAdminEmail(email: string | null | undefined, list = process.env.ADMIN_EMAILS ?? ""): boolean {
  if (!email) return false;
  return list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export async function grantRole(db: DB, userId: string, role: "CLIENT" | "EXPERT" | "ADMIN") {
  await db
    .update(users)
    .set({ roles: sql`array_append(${users.roles}, ${role}::role)` })
    .where(and(eq(users.id, userId), sql`not (${role}::role = any(${users.roles}))`));
}

export async function getApplicationForUser(db: DB, userId: string) {
  const [row] = await db.select().from(expertApplications).where(eq(expertApplications.userId, userId));
  return row ?? null;
}

/** Submit a new application, or resubmit after a rejection. */
export async function submitApplication(db: DB, userId: string, input: ApplicationInput) {
  const existing = await getApplicationForUser(db, userId);
  if (existing && existing.status !== "REJECTED") {
    throw new VettingError(`You already have an application (${existing.status.toLowerCase().replace("_", " ")}).`);
  }
  const cv = real(input.cvFile), sample = real(input.sampleFile), id = real(input.idFile);
  if (cv) checkDoc(cv, "Your CV", DOC_TYPES);
  if (sample) checkDoc(sample, "Your work sample", DOC_TYPES);
  if (id) checkDoc(id, "Your ID", ID_TYPES);
  // after a rejection, documents already sent can be kept
  const keep = existing?.status === "REJECTED";
  if (!cv && !input.cvUrl && !(keep && (existing!.cvFileId || existing!.cvUrl))) throw new VettingError("Please upload your CV (or add a link to it).");
  if (!sample && !input.sampleUrl && !(keep && (existing!.sampleFileId || existing!.sampleUrl))) throw new VettingError("Please upload a work sample (or add a link to one).");
  if (!id && !(keep && existing!.idFileId)) throw new VettingError("Please upload a photo or scan of a government-issued ID.");

  const [cvFileId, sampleFileId, idFileId] = await Promise.all([cv ? saveDoc(db, userId, cv) : null, sample ? saveDoc(db, userId, sample) : null, id ? saveDoc(db, userId, id) : null]);
  const replaced = keep ? [cvFileId && existing!.cvFileId, sampleFileId && existing!.sampleFileId, idFileId && existing!.idFileId].filter((x): x is string => !!x) : [];
  const values = {
    qualification: input.qualification,
    fields: input.fields,
    experienceYears: input.experienceYears,
    pitch: input.pitch,
    cvUrl: cv ? null : input.cvUrl || (keep ? existing!.cvUrl : null),
    sampleUrl: sample ? null : input.sampleUrl || (keep ? existing!.sampleUrl : null),
    cvFileId: cvFileId ?? (keep && !input.cvUrl ? existing!.cvFileId : null),
    sampleFileId: sampleFileId ?? (keep && !input.sampleUrl ? existing!.sampleFileId : null),
    idFileId: idFileId ?? (keep ? existing!.idFileId : null),
    litRetriever: !!input.litRetriever,
    status: "SUBMITTED" as const,
    reviewerNote: null,
    reviewedAt: null,
  };
  if (!existing) {
    const [row] = await db.insert(expertApplications).values({ userId, ...values }).returning();
    return row;
  }
  const [row] = await db.update(expertApplications).set(values).where(eq(expertApplications.id, existing.id)).returning();
  if (replaced.length) await db.delete(files).where(inArray(files.id, replaced));
  return row;
}

/** ID documents are deleted `days` after the decision: they were needed only to verify the person. */
export async function purgeIdDocuments(db: DB, now = new Date(), days = 60) {
  const old = await db
    .select({ id: expertApplications.id, fileId: expertApplications.idFileId })
    .from(expertApplications)
    .where(and(isNotNull(expertApplications.idFileId), inArray(expertApplications.status, ["APPROVED", "REJECTED"]), lt(expertApplications.reviewedAt, new Date(now.getTime() - days * 86_400_000))));
  for (const a of old) {
    await db.update(expertApplications).set({ idFileId: null }).where(eq(expertApplications.id, a.id));
    await db.delete(files).where(eq(files.id, a.fileId!));
  }
  return old.length;
}

/** File names and sizes for an application's uploads (admin view). */
export async function applicationDocs(db: DB, app: { cvFileId: string | null; sampleFileId: string | null; idFileId: string | null }) {
  const ids = [app.cvFileId, app.sampleFileId, app.idFileId].filter((x): x is string => !!x);
  const rows = ids.length ? await db.select({ id: files.id, name: files.name, sizeBytes: files.sizeBytes }).from(files).where(inArray(files.id, ids)) : [];
  const get = (id: string | null) => rows.find((r) => r.id === id) ?? null;
  return { cv: get(app.cvFileId), sample: get(app.sampleFileId), id: get(app.idFileId) };
}

export async function listApplications(db: DB, status?: "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "REJECTED") {
  return db
    .select({
      id: expertApplications.id,
      status: expertApplications.status,
      qualification: expertApplications.qualification,
      fields: expertApplications.fields,
      experienceYears: expertApplications.experienceYears,
      createdAt: expertApplications.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(expertApplications)
    .innerJoin(users, eq(users.id, expertApplications.userId))
    .where(status ? eq(expertApplications.status, status) : undefined)
    .orderBy(desc(expertApplications.createdAt));
}

export async function getApplication(db: DB, id: string) {
  const [row] = await db
    .select({ app: expertApplications, name: users.name, email: users.email })
    .from(expertApplications)
    .innerJoin(users, eq(users.id, expertApplications.userId))
    .where(eq(expertApplications.id, id));
  return row ?? null;
}

/** Approve: marks the application, creates the expert profile and grants the EXPERT role, atomically. */
export async function approveApplication(db: DB, p: { applicationId: string; note?: string }) {
  const result = await db.transaction(async (tx) => {
    const [app] = await tx.select().from(expertApplications).where(eq(expertApplications.id, p.applicationId)).for("update");
    if (!app) throw new VettingError("Application not found");
    if (app.status === "APPROVED" || app.status === "REJECTED") throw new VettingError(`Application is already ${app.status.toLowerCase()}`);

    await tx
      .update(expertApplications)
      .set({ status: "APPROVED", reviewerNote: p.note || null, reviewedAt: new Date() })
      .where(eq(expertApplications.id, app.id));

    const headline = `${app.qualification} · ${app.fields.slice(0, 2).join(", ")}`;
    await tx
      .insert(expertProfiles)
      .values({ userId: app.userId, headline, skills: app.fields, credentials: [app.qualification], verifiedAt: new Date(), litRetriever: app.litRetriever })
      .onConflictDoUpdate({ target: expertProfiles.userId, set: { verifiedAt: new Date(), ...(app.litRetriever ? { litRetriever: true } : {}) } });

    await grantRole(tx as unknown as DB, app.userId, "EXPERT");
    return { userId: app.userId };
  });
  await notify(db, {
    userId: result.userId,
    kind: "APPLICATION_DECIDED",
    title: "You're approved as a True Scholars expert",
    body: "Welcome to the network. Create your first service so clients can hire you.",
    link: "/expert/services/new",
  });
  return result;
}

export async function rejectApplication(db: DB, p: { applicationId: string; note: string }) {
  if (!p.note.trim()) throw new VettingError("Please give the applicant a reason.");
  const [app] = await db.select().from(expertApplications).where(eq(expertApplications.id, p.applicationId));
  if (!app) throw new VettingError("Application not found");
  if (app.status === "APPROVED") throw new VettingError("Application is already approved");
  await db
    .update(expertApplications)
    .set({ status: "REJECTED", reviewerNote: p.note.trim(), reviewedAt: new Date() })
    .where(eq(expertApplications.id, app.id));
  await notify(db, {
    userId: app.userId,
    kind: "APPLICATION_DECIDED",
    title: "An update on your expert application",
    body: "Your application wasn't approved this time. See the reviewer's note and reapply when ready.",
    link: "/apply",
  });
}

export async function markInReview(db: DB, applicationId: string) {
  await db
    .update(expertApplications)
    .set({ status: "IN_REVIEW" })
    .where(and(eq(expertApplications.id, applicationId), eq(expertApplications.status, "SUBMITTED")));
}
