import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";

/** Server-side guard: returns the session user or redirects to sign-in; 404s if the role is missing. */
export async function requireUser(role?: "CLIENT" | "EXPERT" | "ADMIN") {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  if (role && !session.user.roles.includes(role)) notFound();
  return session.user;
}
