"use server";

import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TooManyAttempts, auth, hashPassword, signIn, signOut } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { resetPassword, sendPasswordReset, sendVerification } from "@/server/authTokens";
import { clientIp, hit } from "@/server/rateLimit";

export type FormState = { error?: string } | undefined;

/** Where to go after signing in: only paths on this site, never another domain. */
function nextPath(form: FormData | undefined, fallback: string) {
  const n = String(form?.get("next") ?? "");
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : fallback;
}

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Please enter your full name"),
  email: z.string().trim().toLowerCase().email("Please enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(128, "Use at most 128 characters"),
  intent: z.enum(["client", "expert"]),
});

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form" };
  const { name, email, password, intent } = parsed.data;

  const db = getDb();
  if (!(await hit(db, `signup:ip:${clientIp(await headers())}`, 6, 3600))) return { error: "Too many new accounts from your connection. Please try again in an hour." };
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (exists) return { error: "An account with this email already exists. Try signing in." };

  // Everyone starts as a client; experts become EXPERT only after vetting approval.
  const [created] = await db.insert(users).values({ name: name.slice(0, 120), email, passwordHash: await hashPassword(password), roles: ["CLIENT"] }).returning({ id: users.id });
  await sendVerification(db, { id: created.id, email }).catch(() => false);

  await signIn("credentials", { email, password, redirectTo: nextPath(form, intent === "expert" ? "/apply" : "/dashboard") });
  return undefined;
}

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      redirectTo: nextPath(form, "/dashboard"),
    });
  } catch (err) {
    if (err instanceof TooManyAttempts || (err instanceof AuthError && (err as { code?: string }).code === "rate_limited")) return { error: "Too many attempts. For your security, wait 15 minutes, or reset your password." };
    if (err instanceof AuthError) return { error: "Email or password is incorrect." };
    throw err; // lets Next.js perform the redirect
  }
  return undefined;
}

export async function googleSignInAction(form?: FormData) {
  await signIn("google", { redirectTo: nextPath(form, "/dashboard") });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

// ───────── forgotten passwords and email verification ─────────

export async function forgotPasswordAction(_prev: { sent?: boolean; error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!z.email().safeParse(email).success) return { error: "Please enter a valid email." };
  const db = getDb();
  const ip = clientIp(await headers());
  const [a, b] = await Promise.all([hit(db, `reset:email:${email}`, 3, 3600), hit(db, `reset:ip:${ip}`, 10, 3600)]);
  if (a && b) await sendPasswordReset(db, email);
  return { sent: true }; // the same answer whether or not the account exists
}

export async function resetPasswordAction(_prev: { error?: string } | undefined, form: FormData) {
  const password = String(form.get("password") ?? "");
  if (password.length < 8 || password.length > 128) return { error: "Use 8 to 128 characters." };
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  const ok = await resetPassword(getDb(), String(form.get("token") ?? ""), await hashPassword(password));
  if (!ok) return { error: "This link has expired or was already used. Ask for a new one." };
  redirect("/sign-in?changed=1");
}

export async function resendVerificationAction() {
  const s = await auth();
  if (!s?.user?.id) return { error: "Please sign in." };
  const db = getDb();
  const [u] = await db.select({ email: users.email, verified: users.emailVerified }).from(users).where(eq(users.id, s.user.id));
  if (!u || u.verified) return { ok: "Your email is already confirmed." };
  if (!(await hit(db, `verify:user:${s.user.id}`, 3, 3600))) return { error: "We've sent a few already. Check your spam folder, or try again in an hour." };
  const sent = await sendVerification(db, { id: s.user.id, email: u.email });
  return sent ? { ok: `Sent to ${u.email}. Check your inbox (and spam).` } : { error: "Email isn't switched on yet. Please contact us." };
}
