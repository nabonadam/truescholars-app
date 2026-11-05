import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationForm } from "@/components/ApplicationForm";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { EXPERT_FIELDS, getApplicationForUser, QUALIFICATIONS } from "@/server/vetting";

export const metadata: Metadata = { title: "Become an expert" };
export const dynamic = "force-dynamic";

const STATUS_COPY = {
  SUBMITTED: { title: "Application received", body: "Thank you. Our team will review your credentials and sample, usually within a few working days." },
  IN_REVIEW: { title: "Your application is being reviewed", body: "A reviewer is looking at your credentials and sample now. Check back here for the decision." },
  APPROVED: { title: "You're approved", body: "Welcome to The True Scholars network. You can now create services and bid on jobs." },
  REJECTED: { title: "Your application wasn't approved this time", body: "You can update your details and apply again." },
} as const;

export default async function ApplyPage() {
  const user = await requireUser();
  const app = await getApplicationForUser(getDb(), user.id);
  const showForm = !app || app.status === "REJECTED";

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-3">
        <span className="eyebrow">For academics</span>
        <h1 className="text-3xl font-bold sm:text-4xl">Become one of The True Scholars</h1>
        <p className="text-lg text-ink-muted">
          Every expert is checked before they can take an order: qualifications, a work sample and identity. It&apos;s why clients trust the work.
        </p>
      </div>

      {app && (
        <div className={`card flex flex-col gap-2 ${app.status === "APPROVED" ? "border-green bg-green-tint" : ""}`}>
          <h2 className="text-xl font-bold">{STATUS_COPY[app.status].title}</h2>
          <p className="text-ink-muted">{STATUS_COPY[app.status].body}</p>
          {app.status === "REJECTED" && app.reviewerNote && (
            <p className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">Reviewer&apos;s note: {app.reviewerNote}</p>
          )}
          {app.status === "APPROVED" && (
            <Link href="/dashboard" className="btn-primary mt-2 self-start">Go to your dashboard</Link>
          )}
        </div>
      )}

      {showForm && (
        <div className="card p-6 sm:p-8">
          <ApplicationForm qualifications={QUALIFICATIONS} fields={EXPERT_FIELDS} />
        </div>
      )}
    </section>
  );
}
