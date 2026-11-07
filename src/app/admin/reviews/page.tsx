import type { Metadata } from "next";
import Link from "next/link";
import { AdminTabs } from "@/components/AdminTabs";
import { ReviewAdminForm } from "@/components/ReviewAdminForm";
import { getDb } from "@/db";
import { ago } from "@/lib/time";
import { requireUser } from "@/server/guards";
import { listReviewsForAdmin } from "@/server/reviews";

export const metadata: Metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

export default async function AdminReviews({ searchParams }: { searchParams: Promise<{ low?: string }> }) {
  await requireUser("ADMIN");
  const { low } = await searchParams;
  const rows = await listReviewsForAdmin(getDb(), { low: low === "1" });
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Admin</span>
        <h1 className="text-3xl font-bold">Reviews</h1>
        <p className="max-w-3xl text-ink-muted">Every rating left on marketplace orders. Hide a review only if it breaks the rules: abuse, contact details, private project information, or a review that isn&apos;t about the work. The author is told why, and the expert&apos;s rating and level are recalculated.</p>
      </div>
      <AdminTabs active="/admin/reviews" />
      <div className="flex gap-2 text-sm">
        <Link href="/admin/reviews" className={`rounded-full px-3 py-1 font-bold no-underline ${low ? "text-ink" : "bg-green text-white"}`}>All</Link>
        <Link href="/admin/reviews?low=1" className={`rounded-full px-3 py-1 font-bold no-underline ${low ? "bg-green text-white" : "text-ink"}`}>1–2 stars</Link>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <article key={r.id} className={`card flex flex-col gap-2 p-5 ${r.hidden ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-lg text-amber" aria-label={`${r.rating} stars`}>{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span>
              <b>{r.author ?? "?"}</b>
              <span className="text-ink-muted">on {r.aboutExpert ? "expert" : "client"} {r.subject ?? "?"} · {ago(r.createdAt)}</span>
              <Link href={`/orders/${r.orderId}`} className="text-xs font-bold text-green">{r.title} ↗</Link>
              {r.hidden && <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-bold text-white">Hidden: {r.hiddenReason}</span>}
            </div>
            {r.body ? <p>“{r.body}”</p> : <p className="text-sm text-ink-muted">No written feedback.</p>}
            {r.reply && <p className="ml-3 border-l-4 border-amber pl-3 text-sm text-ink-muted">Reply: {r.reply}</p>}
            {r.body || r.hidden ? <ReviewAdminForm reviewId={r.id} hidden={r.hidden} /> : null}
          </article>
        ))}
        {!rows.length && <p className="card p-6 text-center text-ink-muted">No reviews yet.</p>}
      </div>
    </section>
  );
}
