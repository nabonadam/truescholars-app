import type { Metadata } from "next";
import Link from "next/link";
import { startTestPayment } from "@/app/actions/payments";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { isTestMode, paystackConfigured } from "@/lib/paystack";
import { expertAvailable } from "@/server/escrow";
import { requireUser } from "@/server/guards";
import { getApplicationForUser, listApplications } from "@/server/vetting";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const APP_STATUS: Record<string, string> = {
  SUBMITTED: "Application received: awaiting review",
  IN_REVIEW: "Application under review",
  REJECTED: "Not approved yet: you can update and reapply",
};

export default async function Dashboard() {
  const user = await requireUser();
  const db = getDb();
  const isExpert = user.roles.includes("EXPERT");
  const isAdmin = user.roles.includes("ADMIN");
  const [available, application, openApps] = await Promise.all([
    isExpert ? expertAvailable(db, user.id) : Promise.resolve(0),
    isExpert ? Promise.resolve(null) : getApplicationForUser(db, user.id),
    isAdmin ? listApplications(db).then((r) => r.filter((a) => a.status === "SUBMITTED" || a.status === "IN_REVIEW").length) : Promise.resolve(0),
  ]);
  const firstName = user.name?.split(" ")[0] ?? "there";

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Dashboard</span>
        <h1 className="text-3xl font-bold sm:text-4xl">Welcome, {firstName}</h1>
        <div className="flex flex-wrap gap-2">
          {user.roles.map((r) => (
            <span key={r} className="rounded-full bg-green-tint px-3 py-1 text-xs font-bold text-green">
              {r.charAt(0) + r.slice(1).toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <div className="card flex flex-col gap-2">
          <span className="text-sm font-bold text-ink-muted">Wallet</span>
          <span className="font-display text-3xl font-bold">{formatMoney(available)}</span>
          <span className="text-sm text-ink-muted">
            {isExpert ? "Available to withdraw" : "Payments you make are held in escrow until you approve the work."}
          </span>
        </div>

        {isAdmin && (
          <div className="card flex flex-col gap-3 border-green">
            <span className="text-sm font-bold text-ink-muted">Admin · Expert applications</span>
            <span className="font-display text-3xl font-bold">{openApps}</span>
            <span className="text-sm text-ink-muted">waiting for review</span>
            <Link href="/admin/applications" className="btn-primary mt-auto">Review applications</Link>
          </div>
        )}

        {isExpert ? (
          <div className="card flex flex-col gap-3">
            <span className="text-sm font-bold text-ink-muted">Expert</span>
            <p className="text-ink">You&apos;re a vetted expert. Creating services and bidding on jobs arrive in the next update.</p>
          </div>
        ) : (
          <div className="card flex flex-col gap-3">
            <span className="text-sm font-bold text-ink-muted">Become an expert</span>
            <p className="text-ink">{application ? APP_STATUS[application.status] : "Apply to join our vetted network and offer your services."}</p>
            <Link href="/apply" className="btn-outline mt-auto">{application ? "View application" : "Apply now"}</Link>
          </div>
        )}

        {paystackConfigured() && isTestMode() && (
          <div className="card flex flex-col gap-3">
            <span className="text-sm font-bold text-ink-muted">Payments check (test mode)</span>
            <p className="text-ink">Make a GH₵1 test payment with Paystack test cards or test Mobile Money. No real money moves.</p>
            <form action={startTestPayment} className="mt-auto">
              <button className="btn-primary w-full">Run a test payment</button>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
