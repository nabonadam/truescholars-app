import type { expertReviewSummary } from "@/server/reviews";

/** Ratings, the three aspects and recent written reviews for an expert. */
export function ExpertReviews({ reviews, firstName }: { reviews: Awaited<ReturnType<typeof expertReviewSummary>>; firstName: string }) {
  return (
    <>
      {reviews.total > 0 && (
        <div className="card flex flex-col gap-5">
          <h2 className="text-xl font-bold">What clients say about {firstName}</h2>
          <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
            <div className="flex flex-col items-start gap-1 sm:pr-6">
              <span className="font-display text-5xl font-bold">{reviews.average?.toFixed(1)}</span>
              <span className="text-lg text-amber" aria-hidden="true">{"★".repeat(Math.round(reviews.average ?? 0))}<span className="text-line">{"★".repeat(5 - Math.round(reviews.average ?? 0))}</span></span>
              <span className="text-sm text-ink-muted">{reviews.total} review{reviews.total === 1 ? "" : "s"}{reviews.recommendPct !== null ? ` · ${reviews.recommendPct}% would recommend` : ""}</span>
            </div>
            <dl className="flex flex-col gap-2">
              {([["Communication", reviews.aspects.communication], ["Quality of work", reviews.aspects.quality], ["Delivered on time", reviews.aspects.timeliness]] as const).filter(([, v]) => v !== null).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3 text-sm">
                  <dt>{k}</dt>
                  <dd className="h-2 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-amber" style={{ width: `${((v ?? 0) / 5) * 100}%` }} /></dd>
                  <dd className="text-right font-bold tabular-nums">{v?.toFixed(1)}</dd>
                </div>
              ))}
            </dl>
          </div>
          {reviews.recent.length > 0 && (
            <ul className="flex flex-col divide-y divide-line border-t border-line">
              {reviews.recent.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 py-4">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-amber" aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span>
                    {r.recommend && <span className="rounded-full bg-green-tint px-2 py-0.5 text-xs font-bold text-green">Recommends</span>}
                  </span>
                  <p>{r.body}</p>
                  <span className="text-xs text-ink-muted">{r.author?.split(" ")[0]} · {r.createdAt.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>
                  {r.reply && (
                    <div className="mt-2 ml-3 border-l-4 border-amber pl-3 text-sm">
                      <b>{firstName}&apos;s reply</b>
                      <p className="text-ink-muted">{r.reply}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
