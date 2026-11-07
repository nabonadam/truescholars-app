/** Account settings: profile, photo, expert profile, password and notification preferences. */

import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { avatars, expertProfiles, users } from "@/db/schema";

export class AccountError extends Error {}

export const MAX_AVATAR_BYTES = 1_000_000;
const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};

export async function getAccount(db: DB, userId: string) {
  const [u] = await db
    .select({ id: users.id, name: users.name, email: users.email, country: users.country, image: users.image, roles: users.roles, hasPassword: sql<boolean>`${users.passwordHash} is not null`, emailNotifications: users.emailNotifications, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!u) return null;
  const [profile] = await db.select({ headline: expertProfiles.headline, bio: expertProfiles.bio, skills: expertProfiles.skills, level: expertProfiles.level, litRetriever: expertProfiles.litRetriever }).from(expertProfiles).where(eq(expertProfiles.userId, userId));
  return { ...u, expert: profile ?? null };
}

export async function updateProfile(db: DB, userId: string, p: { name: string; country: string }) {
  const name = p.name.trim().replace(/\s+/g, " ");
  const country = p.country.trim().slice(0, 60);
  if (name.length < 2 || name.length > 80) throw new AccountError("Enter your full name (2–80 characters).");
  if (!/[\p{L}]/u.test(name)) throw new AccountError("Your name should contain letters.");
  await db.update(users).set({ name, country: country || null }).where(eq(users.id, userId));
}

/** Saves a profile photo after checking it really is a small image of an allowed type. */
export async function setAvatar(db: DB, userId: string, file: { type: string; bytes: Buffer }) {
  const check = IMAGE_TYPES[file.type];
  if (!check) throw new AccountError("Use a JPG, PNG or WebP image.");
  if (file.bytes.length === 0) throw new AccountError("That image is empty.");
  if (file.bytes.length > MAX_AVATAR_BYTES) throw new AccountError("That image is too large. Try a smaller photo.");
  if (!check(file.bytes)) throw new AccountError("That file doesn't look like a real image.");
  await db
    .insert(avatars)
    .values({ userId, mimeType: file.type, data: file.bytes })
    .onConflictDoUpdate({ target: avatars.userId, set: { mimeType: file.type, data: file.bytes, updatedAt: new Date() } });
  // The version in the URL makes every page show the new photo at once (browsers cache by URL).
  const image = `/api/avatar/${userId}?v=${Date.now().toString(36)}`;
  await db.update(users).set({ image }).where(eq(users.id, userId));
  return image;
}

export async function removeAvatar(db: DB, userId: string) {
  await db.delete(avatars).where(eq(avatars.userId, userId));
  await db.update(users).set({ image: null }).where(eq(users.id, userId));
}

export async function getAvatar(db: DB, userId: string) {
  const [a] = await db.select().from(avatars).where(eq(avatars.userId, userId));
  return a ?? null;
}

export function passwordProblem(pw: string) {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 200) return "That password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9\W_]/.test(pw)) return "Mix letters with at least one number or symbol.";
  return null;
}

/**
 * Changes (or, for Google-only accounts, sets) the password. Bumps the session version so every
 * other signed-in device is signed out on its next request.
 */
export async function changePassword(db: DB, userId: string, p: { current: string; next: string; confirm: string }) {
  const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!u) throw new AccountError("Account not found.");
  if (u.hash && !(await bcrypt.compare(p.current, u.hash))) throw new AccountError("Your current password is not right.");
  const problem = passwordProblem(p.next);
  if (problem) throw new AccountError(problem);
  if (p.next !== p.confirm) throw new AccountError("The two new passwords don't match.");
  if (u.hash && (await bcrypt.compare(p.next, u.hash))) throw new AccountError("Choose a password different from your current one.");
  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(p.next, 12), sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId));
}

export async function setEmailNotifications(db: DB, userId: string, on: boolean) {
  await db.update(users).set({ emailNotifications: on }).where(eq(users.id, userId));
}

export async function updateExpertProfile(db: DB, userId: string, p: { headline: string; bio: string; skills: string[]; litRetriever?: boolean }) {
  const headline = p.headline.trim().replace(/\s+/g, " ");
  const bio = p.bio.trim();
  if (headline.length < 10 || headline.length > 120) throw new AccountError("Write a headline of 10–120 characters, e.g. “Biostatistician · PhD, University of Ghana”.");
  if (bio.length > 2000) throw new AccountError("Keep your bio under 2,000 characters.");
  const seen = new Set<string>();
  const skills = p.skills.map((s) => s.trim()).filter((s) => s && s.length <= 30 && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
  if (skills.length > 15) throw new AccountError("List up to 15 skills.");
  const res = await db.update(expertProfiles).set({ headline, bio: bio || null, skills, ...(p.litRetriever === undefined ? {} : { litRetriever: p.litRetriever }) }).where(eq(expertProfiles.userId, userId)).returning({ id: expertProfiles.id });
  if (res.length === 0) throw new AccountError("You don't have an expert profile yet.");
}
