/** Expert vetting: applications, admin decisions, and the admin allow-list. */

import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { expertApplications, expertProfiles, users } from "@/db/schema";

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
}

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
  const values = {
    qualification: input.qualification,
    fields: input.fields,
    experienceYears: input.experienceYears,
    pitch: input.pitch,
    cvUrl: input.cvUrl || null,
    sampleUrl: input.sampleUrl || null,
    status: "SUBMITTED" as const,
    reviewerNote: null,
    reviewedAt: null,
  };
  if (!existing) {
    const [row] = await db.insert(expertApplications).values({ userId, ...values }).returning();
    return row;
  }
  if (existing.status !== "REJECTED") {
    throw new VettingError(`You already have an application (${existing.status.toLowerCase().replace("_", " ")}).`);
  }
  const [row] = await db.update(expertApplications).set(values).where(eq(expertApplications.id, existing.id)).returning();
  return row;
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
  return db.transaction(async (tx) => {
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
      .values({ userId: app.userId, headline, skills: app.fields, credentials: [app.qualification], verifiedAt: new Date() })
      .onConflictDoUpdate({ target: expertProfiles.userId, set: { verifiedAt: new Date() } });

    await grantRole(tx as unknown as DB, app.userId, "EXPERT");
    return { userId: app.userId };
  });
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
}

export async function markInReview(db: DB, applicationId: string) {
  await db
    .update(expertApplications)
    .set({ status: "IN_REVIEW" })
    .where(and(eq(expertApplications.id, applicationId), eq(expertApplications.status, "SUBMITTED")));
}
