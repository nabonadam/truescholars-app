import { ReplyForm, ReviewForm } from "@/components/OrderRoomForms";
import { BLIND_DAYS, orderReviewState, type reviewsForOrder } from "@/server/reviews";

type Rev = Awaited<ReturnType<typeof reviewsForOrder>>[number];
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function StarsRow({ n, size = "text-lg" }: { n: number; size?: string }) {
  return <span className={`${size} tracking-tight`} aria-label={`${n} out of 5 stars`}><span className="text-amber">{"★".repeat(n)}</span><span className="text-line">{"★".repeat(5 - n)}</span></span>;
}

function ReviewBody({ r, who }: { r: Rev; who: string }) {
  const aspects = ([["Communication", r.communication], ["Quality", r.quality], ["On time", r.timeliness]] as const).filter(([, v]) => v);
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold">{who}</span>
        <StarsRow n={r.rating} />
        {r.recommend !== null && <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${r.recommend ? "bg-green-tint text-green" : "bg-line text-ink-muted"}`}>{r.recommend ? "Would recommend" : "Wouldn't recommend"}</span>}
      </div>
      {aspects.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {aspects.map(([k, v]) => <span key={k}>{k} <b className="text-ink">{v}/5</b></span>)}
        </div>
      )}
      {r.body && <p className="text-[15px]">“{r.body}”</p>}
      {r.hidden && <p className="text-xs text-amber-deep">Removed by The True Scholars: {r.hiddenReason}</p>}
      {r.reply && (
        <div className="ml-3 border-l-4 border-amber pl-3 text-sm">
          <span className="font-bold">Reply</span> <span className="text-ink-muted">· {r.repliedAt ? fmt(r.repliedAt) : ""}</span>
          <p>{r.reply}</p>
        </div>
      )}
    </div>
  );
}

/** Ratings and feedback, shown near the top of a completed order. */
export function OrderReviews({ order, revs, userId, role, otherName }: { order: { id: string; status: string; completedAt: Date | null; updatedAt: Date }; revs: Rev[]; userId: string; role: "client" | "expert"; otherName: string }) {
  if (order.status !== "COMPLETED") return null;
  const s = orderReviewState(order, revs, userId);
  const first = otherName.split(" ")[0] || (role === "client" ? "your expert" : "your client");
  if (!s.mine && !s.open && !s.theirs) return null;
  return (
    <div id="review" className={`card flex scroll-mt-24 flex-col gap-4 ${s.open ? "border-amber" : ""}`}>
      {s.open ? (
        <>
          <div>
            <span className="eyebrow">Order complete</span>
            <h2 className="text-2xl font-bold">How did it go with {first}?</h2>
            <p className="text-sm text-ink-muted">
              Your rating helps {role === "client" ? "other clients choose the right expert" : "experts know who they're working with"}. Reviews are blind: {first} won&apos;t see yours until they&apos;ve left theirs, or after {BLIND_DAYS} days. Open until {fmt(s.closes)}.
            </p>
          </div>
          <ReviewForm orderId={order.id} subjectName={first} asClient={role === "client"} />
        </>
      ) : (
        <h2 className="text-xl font-bold">Reviews</h2>
      )}
      {s.mine && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold text-ink-muted">Your review of {first}{s.mineVisible ? "" : ` · visible to ${first} once they review, or on ${fmt(s.blindEnds)}`}</span>
          <ReviewBody r={s.mine} who="You" />
        </div>
      )}
      {s.theirsVisible && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold text-ink-muted">{first}&apos;s review of you</span>
          <ReviewBody r={s.theirsVisible} who={first} />
          {!s.theirsVisible.reply && !s.theirsVisible.hidden && <ReplyForm orderId={order.id} reviewId={s.theirsVisible.id} />}
        </div>
      )}
      {s.theirsWaiting && <p className="rounded-sm bg-green-tint px-4 py-3 text-sm text-green"><b>{first} has reviewed you.</b> {s.mine ? `You'll see it on ${fmt(s.blindEnds)}.` : "Leave your review to see it."}</p>}
      {!s.mine && !s.open && <p className="text-sm text-ink-muted">Reviews for this order have closed.</p>}
    </div>
  );
}
