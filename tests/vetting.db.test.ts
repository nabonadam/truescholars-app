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
  sampleUrl: null,
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
    await rejectApplication(db, { applicationId: app.id, note: "Please add a work sample" });
    const again = await submitApplication(db, userId, { ...input, sampleUrl: "https://example.com/sample.pdf" });
    expect(again.id).toBe(app.id);
    expect(again.status).toBe("SUBMITTED");
    expect(again.reviewerNote).toBeNull();
    expect(await roles()).not.toContain("EXPERT");
  });
});
