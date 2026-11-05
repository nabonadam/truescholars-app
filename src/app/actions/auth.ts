"use server";

import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { z } from "zod";
import { hashPassword, signIn, signOut } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export type FormState = { error?: string } | undefined;

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Please enter your full name"),
  email: z.string().trim().toLowerCase().email("Please enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
  intent: z.enum(["client", "expert"]),
});

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form" };
  const { name, email, password, intent } = parsed.data;

  const db = getDb();
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (exists) return { error: "An account with this email already exists. Try signing in." };

  // Everyone starts as a client; experts become EXPERT only after vetting approval.
  await db.insert(users).values({ name, email, passwordHash: await hashPassword(password), roles: ["CLIENT"] });

  await signIn("credentials", { email, password, redirectTo: intent === "expert" ? "/apply" : "/dashboard" });
  return undefined;
}

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      redirectTo: "/dashboard",
    });
  } catch (err) {
    if (err instanceof AuthError) return { error: "Email or password is incorrect." };
    throw err; // lets Next.js perform the redirect
  }
  return undefined;
}

export async function googleSignInAction() {
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
