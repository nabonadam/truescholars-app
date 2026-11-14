import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import {
  approveApplication,
  grantRole,
  isAdminEmail,
  rejectApplication,
  applicationDocs,
  purgeIdDocuments,
  submitApplication,
  VettingError,
} from "@/server/vetting";

let db: DB;
let userId: string;
const input = {
  qualification: "PhD",
  fields: ["Statistics & data analysis", "Research methodology"],
  experienceYears: 6,
  pitch: "I run regression and survival analyses in Stata and R for health researchers, with clear write-ups.",
  cvUrl: "https://example.com/cv.pdf",
  sampleUrl: "https://example.com/sample.pdf" as string | null,
  idFile: new File([new Uint8Array(20)], "ghana-card.jpg", { type: "image/jpeg" }) as File | null,
};

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "ama@example.com", name: "Ama" }).returning();
  userId = u.id;
});

const roles = async () => (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0].roles;

describe("vetting", () => {
  it("recognises admin emails case-insensitively", () => {
    expect(isAdminEmail("Cosmos@Example.com", "cosmos@example.com, other@x.org")).toBe(true);
    expect(isAdminEmail("someone@x.org", "cosmos@example.com")).toBe(false);
    expect(isAdminEmail("a@b.c", "")).toBe(false);
  });

  it("grants a role once", async () => {
    await grantRole(db, userId, "ADMIN");
    await grantRole(db, userId, "ADMIN");
    expect(await roles()).toEqual(["CLIENT", "ADMIN"]);
  });

  it("approving creates the expert profile and EXPERT role", async () => {
    const app = await submitApplication(db, userId, input);
    await approveApplication(db, { applicationId: app.id });
    expect(await roles()).toContain("EXPERT");
    const [profile] = await db.select().from(schema.expertProfiles).where(eq(schema.expertProfiles.userId, userId));
    expect(profile.skills).toEqual(input.fields);
    expect(profile.verifiedAt).not.toBeNull();
    await expect(approveApplication(db, { applicationId: app.id })).rejects.toThrow(VettingError);
  });

  it("blocks duplicate applications but allows reapplying after rejection", async () => {
    const app = await submitApplication(db, userId, input);
    await expect(submitApplication(db, userId, input)).rejects.toThrow(VettingError);
    await expect(rejectApplication(db, { applicationId: app.id, note: "  " })).rejects.toThrow(/reason/);
    await rejectApplication(db, { applicationId: app.id, note: "Please add a better work sample" });
    // the ID already sent is kept; a new sample replaces the old link
    const again = await submitApplication(db, userId, { ...input, idFile: null, sampleUrl: "https://example.com/sample2.pdf" });
    expect(again.idFileId).toBe(app.idFileId);
    expect(again.sampleUrl).toBe("https://example.com/sample2.pdf");
    expect(again.id).toBe(app.id);
    expect(again.status).toBe("SUBMITTED");
    expect(again.reviewerNote).toBeNull();
    expect(await roles()).not.toContain("EXPERT");
  });

  it("needs a CV, a work sample and an ID, stores uploads privately, and deletes the ID after the decision", async () => {
    await expect(submitApplication(db, userId, { ...input, idFile: null })).rejects.toThrow(/government-issued ID/);
    await expect(submitApplication(db, userId, { ...input, sampleUrl: null })).rejects.toThrow(/work sample/);
    await expect(submitApplication(db, userId, { ...input, idFile: new File(["x"], "id.exe") })).rejects.toThrow(/isn't accepted/);
    const cvFile = new File([new Uint8Array(500)], "cv.pdf", { type: "application/pdf" });
    const app = await submitApplication(db, userId, { ...input, cvUrl: null, cvFile });
    expect(app.cvUrl).toBeNull();
    const docs = await applicationDocs(db, app);
    expect(docs.cv?.name).toBe("cv.pdf");
    expect(docs.id?.name).toBe("ghana-card.jpg");

    const { getFileForUser } = await import("@/server/files");
    const [other] = await db.insert(schema.users).values({ email: "x@example.com" }).returning();
    expect(await getFileForUser(db, app.idFileId!, { id: other.id, roles: ["CLIENT", "EXPERT"] })).toBeNull();
    expect(await getFileForUser(db, app.idFileId!, { id: other.id, roles: ["ADMIN"] })).not.toBeNull();

    await approveApplication(db, { applicationId: app.id });
    expect(await purgeIdDocuments(db, new Date())).toBe(0);
    expect(await purgeIdDocuments(db, new Date(Date.now() + 61 * 86_400_000))).toBe(1);
    const [after] = await db.select().from(schema.expertApplications).where(eq(schema.expertApplications.id, app.id));
    expect(after.idFileId).toBeNull();
    expect(after.cvFileId).toBe(app.cvFileId);
    expect(await db.select().from(schema.files).where(eq(schema.files.id, app.idFileId!))).toHaveLength(0);
  });
});
