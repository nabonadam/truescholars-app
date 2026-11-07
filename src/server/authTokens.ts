/**
 * One-time email links: password reset (1 hour) and email verification (3 days). The link carries a
 * random token; only its SHA-256 hash is stored, so a database leak can't be turned into working links.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { authTokens, users } from "@/db/schema";
import { renderEmail, sendEmail } from "@/lib/mailer";

type Kind = "reset" | "verify";
const TTL: Record<Kind, number> = { reset: 60 * 60 * 1000, verify: 3 * 24 * 60 * 60 * 1000 };
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export async function createToken(db: DB, userId: string, kind: Kind, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  // a new link replaces any earlier unused one of the same kind
  await db.update(authTokens).set({ usedAt: now }).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)));
  await db.insert(authTokens).values({ userId, kind, tokenHash: hash(token), expiresAt: new Date(now.getTime() + TTL[kind]) });
  return token;
}

/** Uses a link once: returns its user, or null if it's unknown, used or expired. */
export async function consumeToken(db: DB, token: string, kind: Kind, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(eq(authTokens.tokenHash, hash(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)))
    .returning({ userId: authTokens.userId });
  return row?.userId ?? null;
}

/** Is this reset link still good (without using it up)? For showing the form. */
export async function tokenValid(db: DB, token: string, kind: Kind, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  const [row] = await db.select({ id: authTokens.id }).from(authTokens).where(and(eq(authTokens.tokenHash, hash(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)));
  return !!row;
}

export async function sendVerification(db: DB, user: { id: string; email: string }) {
  const token = await createToken(db, user.id, "verify");
  return sendEmail({
    to: user.email,
    subject: "Confirm your email for The True Scholars",
    html: renderEmail({ title: "Confirm your email address", body: "Click below to confirm this is your email. The link works for 3 days.", ctaLabel: "Confirm my email", ctaUrl: `${appUrl()}/verify-email?token=${token}` }),
  });
}

/** Sends a reset link if the account exists. Says nothing either way, so emails can't be probed. */
export async function sendPasswordReset(db: DB, email: string) {
  const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!u) return;
  const token = await createToken(db, u.id, "reset");
  await sendEmail({
    to: u.email,
    subject: "Reset your True Scholars password",
    html: renderEmail({ title: "Reset your password", body: "Someone (hopefully you) asked to reset your password. The link works for one hour. If it wasn't you, ignore this email: your password stays the same.", ctaLabel: "Choose a new password", ctaUrl: `${appUrl()}/reset-password?token=${token}` }),
  });
}

/** Sets a new password from a reset link: proves the email too, and signs out every other session. */
export async function resetPassword(db: DB, token: string, passwordHash: string) {
  const userId = await consumeToken(db, token, "reset");
  if (!userId) return false;
  await db
    .update(users)
    .set({ passwordHash, emailVerified: sql`coalesce(${users.emailVerified}, now())`, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId));
  return true;
}

export async function verifyEmail(db: DB, token: string) {
  const userId = await consumeToken(db, token, "verify");
  if (!userId) return false;
  await db.update(users).set({ emailVerified: sql`coalesce(${users.emailVerified}, now())` }).where(eq(users.id, userId));
  return true;
}
