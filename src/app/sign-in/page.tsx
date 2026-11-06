import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/AuthShell";
import { SignInForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ changed?: string; next?: string }> }) {
  const { changed, next } = await searchParams;
  // Already signed in: never show the login form again; go where they were heading.
  if ((await auth())?.user) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  return (
    <AuthShell next={next} title={changed ? "Password changed" : "Welcome back"} subtitle={changed ? "Log in with your new password. You've been signed out on all your devices." : "Sign in to your True Scholars account."}>
      {changed && (
        <p role="status" className="flex items-center gap-2 rounded-sm bg-green-tint px-4 py-3 text-sm font-medium text-green">
          <span className="grid size-5 flex-none place-items-center rounded-full bg-green text-[11px] text-white">✓</span> Your new password is saved.
        </p>
      )}
      <SignInForm next={next} />
    </AuthShell>
  );
}
