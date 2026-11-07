import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { ResetPasswordForm } from "@/components/AuthForms";
import { getDb } from "@/db";
import { tokenValid } from "@/server/authTokens";

export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const ok = await tokenValid(getDb(), token, "reset");
  return (
    <AuthShell title={ok ? "Choose a new password" : "This link has expired"} subtitle={ok ? "You'll be signed out on all your devices, then you can sign in with the new password." : "Reset links work once, for one hour."}>
      {ok ? <ResetPasswordForm token={token} /> : <Link href="/forgot-password" className="btn-primary w-full text-center">Send me a new link</Link>}
    </AuthShell>
  );
}
