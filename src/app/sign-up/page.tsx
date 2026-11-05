import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { SignUpForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  return (
    <AuthShell title="Create your account" subtitle="Free to join. Experts are approved after a short vetting review.">
      <SignUpForm asExpert={as === "expert"} />
    </AuthShell>
  );
}
