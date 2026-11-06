import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/AuthShell";
import { SignUpForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ as?: string; next?: string }> }) {
  const { as, next } = await searchParams;
  // Already signed in: never show the login form again; go where they were heading.
  if ((await auth())?.user) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  const stats = next?.startsWith("/tools/stats");
  return (
    <AuthShell
      next={next}
      title={stats ? "Start your free trial" : "Create your account"}
      subtitle={stats ? "Two days of the Statistics Assistant, free. No card needed." : "Free to join. Experts are approved after a short vetting review."}
    >
      <SignUpForm asExpert={as === "expert"} next={next} />
    </AuthShell>
  );
}
