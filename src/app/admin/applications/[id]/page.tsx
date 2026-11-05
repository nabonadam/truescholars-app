import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveAction } from "@/app/actions/vetting";
import { RejectForm } from "@/components/RejectForm";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { getApplication, markInReview } from "@/server/vetting";

export const metadata: Metadata = { title: "Review application" };
export const dynamic = "force-dynamic";

export default async function ReviewApplication({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  await requireUser("ADMIN");
  const { id } = await params;
  const { done } = await searchParams;
  const db = getDb();
  const row = await getApplication(db, id);
  if (!row) notFound();
  if (row.app.status === "SUBMITTED") await markInReview(db, id); // opening it claims it for review
  const { app } = row;
  const decided = app.status === "APPROVED" || app.status === "REJECTED";

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Link href="/admin/applications" className="text-sm font-bold text-green">← All applications</Link>

      {done && (
        <p role="status" className="rounded-sm bg-green-tint px-4 py-3 text-sm font-bold text-green">
          Application {done}.{done === "approved" ? " They can now create services and bid on jobs." : ""}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className="eyebrow">Expert application</span>
        <h1 className="text-3xl font-bold">{row.name ?? row.email}</h1>
        <p className="text-ink-muted">{row.email} · submitted {app.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
      </div>

      <div className="card grid gap-5 sm:grid-cols-2">
        <div><div className="text-sm font-bold text-ink-muted">Qualification</div><div>{app.qualification}</div></div>
        <div><div className="text-sm font-bold text-ink-muted">Experience</div><div>{app.experienceYears} years</div></div>
        <div className="sm:col-span-2"><div className="text-sm font-bold text-ink-muted">Fields</div><div>{app.fields.join(", ")}</div></div>
        <div className="sm:col-span-2">
          <div className="text-sm font-bold text-ink-muted">Pitch</div>
          <p className="whitespace-pre-line">{app.pitch}</p>
        </div>
        <div>
          <div className="text-sm font-bold text-ink-muted">CV</div>
          {app.cvUrl ? <a href={app.cvUrl} target="_blank" rel="noopener noreferrer nofollow" className="font-bold text-green break-all">Open CV ↗</a> : "—"}
        </div>
        <div>
          <div className="text-sm font-bold text-ink-muted">Work sample</div>
          {app.sampleUrl ? <a href={app.sampleUrl} target="_blank" rel="noopener noreferrer nofollow" className="font-bold text-green break-all">Open sample ↗</a> : "Not provided"}
        </div>
      </div>

      {decided ? (
        <div className="card">
          <div className="font-bold">Decision: {app.status.toLowerCase()}</div>
          {app.reviewerNote && <p className="text-ink-muted">Note: {app.reviewerNote}</p>}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <form action={approveAction} className="card flex flex-col gap-3">
            <input type="hidden" name="applicationId" value={app.id} />
            <h2 className="text-xl font-bold">Approve</h2>
            <p className="text-sm text-ink-muted">Checked the CV, sample and identity? Approving creates their expert profile.</p>
            <label htmlFor="approve-note" className="label">Internal note (optional)</label>
            <textarea id="approve-note" name="note" rows={2} className="field" />
            <button className="btn-primary self-start">Approve expert</button>
          </form>
          <div className="card flex flex-col gap-3">
            <h2 className="text-xl font-bold">Reject</h2>
            <RejectForm applicationId={app.id} />
          </div>
        </div>
      )}
    </section>
  );
}
