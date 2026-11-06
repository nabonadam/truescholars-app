import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { changePassword, getAccount, getAvatar, passwordProblem, removeAvatar, setAvatar, setEmailNotifications, updateExpertProfile, updateProfile } from "@/server/account";

let db: DB;
let id: string;
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);

beforeEach(async () => {
  const d = drizzle(new PGlite(), { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  db = d as unknown as DB;
  const [u] = await d.insert(schema.users).values({ email: "akosua@example.com", name: "Akosua Mensah", passwordHash: await bcrypt.hash("oldpass123", 4) }).returning();
  id = u.id;
});

describe("profile and photo", () => {
  it("updates the name and country", async () => {
    await expect(updateProfile(db, id, { name: "A", country: "" })).rejects.toThrow(/full name/);
    await updateProfile(db, id, { name: "  Akosua   Mensah-Boateng ", country: "Ghana" });
    expect(await getAccount(db, id)).toMatchObject({ name: "Akosua Mensah-Boateng", country: "Ghana", hasPassword: true, expert: null });
  });

  it("accepts only real, small images and versions the URL", async () => {
    await expect(setAvatar(db, id, { type: "image/gif", bytes: jpeg })).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(setAvatar(db, id, { type: "image/jpeg", bytes: Buffer.from("<script>") })).rejects.toThrow(/real image/);
    await expect(setAvatar(db, id, { type: "image/jpeg", bytes: Buffer.alloc(1_100_000, 0xff) })).rejects.toThrow(/too large/);
    const url = await setAvatar(db, id, { type: "image/jpeg", bytes: jpeg });
    expect(url).toMatch(new RegExp(`^/api/avatar/${id}\\?v=`));
    expect((await getAvatar(db, id))?.data.length).toBe(jpeg.length);
    await removeAvatar(db, id);
    expect(await getAvatar(db, id)).toBeNull();
    expect((await getAccount(db, id))?.image).toBeNull();
  });
});

describe("password", () => {
  it("checks the current password, strength and match, then signs out other devices", async () => {
    expect(passwordProblem("short")).toMatch(/8 characters/);
    expect(passwordProblem("onlyletters")).toMatch(/number or symbol/);
    await expect(changePassword(db, id, { current: "wrong", next: "newpass123", confirm: "newpass123" })).rejects.toThrow(/current password/);
    await expect(changePassword(db, id, { current: "oldpass123", next: "newpass123", confirm: "newpass124" })).rejects.toThrow(/don't match/);
    await expect(changePassword(db, id, { current: "oldpass123", next: "oldpass123", confirm: "oldpass123" })).rejects.toThrow(/different/);
    await changePassword(db, id, { current: "oldpass123", next: "newpass123", confirm: "newpass123" });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(await bcrypt.compare("newpass123", u.passwordHash!)).toBe(true);
    expect(u.sessionVersion).toBe(1);
  });

  it("lets a Google-only account set a first password", async () => {
    await db.update(schema.users).set({ passwordHash: null }).where(eq(schema.users.id, id));
    await changePassword(db, id, { current: "", next: "firstpass9", confirm: "firstpass9" });
    expect((await getAccount(db, id))?.hasPassword).toBe(true);
  });
});

describe("preferences and expert profile", () => {
  it("turns email off and on", async () => {
    await setEmailNotifications(db, id, false);
    expect((await getAccount(db, id))?.emailNotifications).toBe(false);
  });

  it("only experts have an expert profile to edit", async () => {
    await expect(updateExpertProfile(db, id, { headline: "Biostatistician, PhD", bio: "", skills: [] })).rejects.toThrow(/expert profile/);
    await db.insert(schema.expertProfiles).values({ userId: id, headline: "Old headline here" });
    await expect(updateExpertProfile(db, id, { headline: "short", bio: "", skills: [] })).rejects.toThrow(/10–120/);
    await updateExpertProfile(db, id, { headline: "Biostatistician · PhD, University of Ghana", bio: "I love survey data.", skills: ["Stata", "stata", " R ", ""] });
    expect((await getAccount(db, id))?.expert).toMatchObject({ headline: "Biostatistician · PhD, University of Ghana", skills: ["Stata", "R"] });
  });
});
