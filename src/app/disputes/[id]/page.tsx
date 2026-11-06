import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileLinks } from "@/components/ChatThread";
import { Icon } from "@/components/Icons";
import { Avatar } from "@/components/People";
import { AcceptOfferButton, AdminDecisionForm, CancelDisputeButton, OfferForm } from "@/components/TrustForms";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { getDispute, REASONS, type ReasonCode } from "@/server/disputes";
import { fileMeta } from "@/server/files";
import { requireUser } from "@/server/guards";
import { markLinkNotificationsRead } from "@/server/notifications";

export const metadata: Metadata = { title: "Dispute" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  OPEN: ["Open", "bg-amber text-ink"],
  RESOLVED_RELEASE: ["Resolved · paid to the expert", "bg-green text-white"],
  RESOLVED_PARTIAL: ["Resolved · split", "bg-green text-white"],
  RESOLVED_REFUND: ["Resolved · refunded", "bg-green text-white"],
  CANCELLED: ["Withdrawn", "bg-line text-ink"],
};

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const v = await getDispute(db, id, { id: user.id, roles: user.roles }).catch(() => null);
  if (!v || !v.milestone) notFound();
  await markLinkNotificationsRead(db, user.id, `/disputes/${id}`);
  const { dispute: d, order, milestone: m, role } = v;
  const open = d.status === "OPEN";
  const amount = m.amountMinor;
  const evidence = new Map((await fileMeta(db, d.evidence)).map((f) => [f.id, f]));
  const [label, tone] = STATUS[d.status] ?? [d.status, "bg-line"];
  const iAmOfferer = d.offerById === user.id;
  const offerFrom = d.offerById === order.clientId ? v.clientName : d.offerById === order.expertId ? v.expertName : null;
  const deadlinePassed = d.respondBy ? d.respondBy < new Date() : false;
  const first = (n: string) => n.split(" ")[0];
  const net = (x: number) => x - Math.round((x * order.feeBps) / 10_000);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href={role === "admin" ? "/admin/disputes" : `/orders/${order.id}`} className="text-sm font-bold text-green">← {role === "admin" ? "All disputes" : "Back to the order"}</Link>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-md bg-ink p-6 text-white">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 flex-none place-items-center rounded-full bg-amber text-ink"><Icon name="scale" size={24} /></span>
          <div className="min-w-0">
            <span className="text-xs font-bold tracking-wider text-amber uppercase">Resolution centre</span>
            <h1 className="text-2xl font-bold text-white">{order.title}</h1>
            <p className="text-on-green-muted">
              {m.title} · {formatMoney(amount, order.currency)} {open ? "frozen in escrow" : ""} · {v.clientName} (client) and {v.expertName} (expert)
            </p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${tone}`}>{label}</span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_400px]">
        {/* Timeline */}
        <ol className="flex flex-col gap-0">
          <TimelineItem icon="scale" tone="amber" who={v.openerName} when={ago(d.createdAt)} title={`opened a dispute: ${REASONS[d.reason as ReasonCode] ?? d.reason}`}>
            <p className="text-[15px] whitespace-pre-line">{d.details}</p>
            {d.evidence.length > 0 && <FileLinks ids={d.evidence} meta={evidence} />}
          </TimelineItem>
          {d.offerAt && d.offerReleaseMinor !== null && offerFrom && (
            <TimelineItem icon="wallet" tone="green" who={offerFrom} when={ago(d.offerAt)} title="proposed a settlement">
              <p className="text-sm">
                <b>{formatMoney(d.offerReleaseMinor, order.currency)}</b> to {first(v.expertName)} and <b>{formatMoney(amount - d.offerReleaseMinor, order.currency)}</b> back to {first(v.clientName)}.
              </p>
            </TimelineItem>
          )}
          {!open && (
            <TimelineItem icon={d.status === "CANCELLED" ? "refresh" : "check"} tone="solid" who={d.status === "CANCELLED" ? v.openerName : "Outcome"} when={d.resolvedAt ? ago(d.resolvedAt) : ""} title={d.status === "CANCELLED" ? "withdrew the dispute" : ""} last>
              {d.status !== "CANCELLED" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-sm bg-green-tint p-3">
                    <div className="text-xs font-bold text-green uppercase">Paid to {first(v.expertName)}</div>
                    <div className="font-display text-xl font-bold text-green">{formatMoney(d.releasedMinor ?? 0, order.currency)}</div>
                  </div>
                  <div className="rounded-sm bg-amber-tint p-3">
                    <div className="text-xs font-bold text-amber-deep uppercase">Refunded to {first(v.clientName)}</div>
                    <div className="font-display text-xl font-bold text-amber-deep">{formatMoney(d.refundedMinor ?? 0, order.currency)}</div>
                  </div>
                </div>
              )}
              {d.decision && <p className="text-sm text-ink-muted">{d.decision}</p>}
            </TimelineItem>
          )}
          {open && (
            <TimelineItem icon="clock" tone="ink" who="Next" when="" title="" last>
              <p className="text-sm text-ink-muted">
                {deadlinePassed
                  ? "The response window has ended. Our team is reviewing the order, the messages and any evidence, and will decide on a fair split."
                  : `Try to agree a split between you. If you can't by ${d.respondBy?.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}, our team will review everything and decide.`}
              </p>
            </TimelineItem>
          )}
        </ol>

        {/* Actions */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          {open && role !== "admin" && (
            <>
              {d.offerReleaseMinor !== null && !iAmOfferer && (
                <div className="card flex flex-col gap-3 border-green">
                  <h2 className="text-lg font-bold">{offerFrom && first(offerFrom)}&apos;s offer</h2>
                  <p className="text-sm">
                    {role === "expert"
                      ? <>You receive <b>{formatMoney(net(d.offerReleaseMinor), order.currency)}</b> (after fee); {first(v.clientName)} gets <b>{formatMoney(amount - d.offerReleaseMinor, order.currency)}</b> back.</>
                      : <>You get <b>{formatMoney(amount - d.offerReleaseMinor, order.currency)}</b> back; {first(v.expertName)} receives <b>{formatMoney(d.offerReleaseMinor, order.currency)}</b>.</>}
                  </p>
                  <AcceptOfferButton disputeId={d.id} label="Accept this offer" />
                </div>
              )}
              {iAmOfferer && <p className="rounded-sm bg-parchment px-4 py-3 text-sm">Your offer has been sent. Waiting for a reply; you can change it below.</p>}
              <div className="card flex flex-col gap-3">
                <h2 className="text-lg font-bold">{iAmOfferer ? "Change your offer" : "Propose a split"}</h2>
                <p className="text-sm text-ink-muted">Slide to choose how much of the {formatMoney(amount, order.currency)} goes to the expert. The rest goes back to the client.</p>
                <OfferForm disputeId={d.id} amountMinor={amount} feeBps={order.feeBps} initial={d.offerReleaseMinor ?? Math.round(amount / 2)} />
              </div>
              <Link href={`/messages?c=${order.id}`} className="btn-outline">Talk it through in messages</Link>
              {d.openedById === user.id && <CancelDisputeButton disputeId={d.id} />}
            </>
          )}
          {open && role === "admin" && (
            <div className="card flex flex-col gap-3 border-amber">
              <h2 className="text-lg font-bold">Decide this dispute</h2>
              <p className="text-sm text-ink-muted">
                Review the <Link href={`/orders/${order.id}`} className="font-bold text-green">order, deliveries and conversation</Link> first.
                {d.offerReleaseMinor !== null && ` Latest offer: ${formatMoney(d.offerReleaseMinor, order.currency)} to the expert.`}
                {!deadlinePassed && " The response window is still open."}
              </p>
              <AdminDecisionForm disputeId={d.id} amountMinor={amount} feeBps={order.feeBps} initial={d.offerReleaseMinor ?? Math.round(amount / 2)} />
            </div>
          )}
          {!open && (
            <div className="card flex flex-col gap-3">
              <h2 className="text-lg font-bold">This dispute is closed</h2>
              <Link href={`/orders/${order.id}`} className="btn-primary">Back to the order</Link>
            </div>
          )}
          <div className="flex items-center gap-3 rounded-md border border-line bg-white p-4 text-sm">
            <Avatar name={role === "client" ? v.expertName : v.clientName} size={36} userId={role === "client" ? order.expertId : order.clientId} />
            <span className="text-ink-muted">Keep it respectful and factual. Our team reads the conversation when deciding.</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function TimelineItem({ icon, tone, who, when, title, children, last = false }: { icon: "scale" | "wallet" | "check" | "clock" | "refresh"; tone: "amber" | "green" | "solid" | "ink"; who: string; when: string; title: string; children: React.ReactNode; last?: boolean }) {
  const t = { amber: "bg-amber text-ink", green: "bg-green-tint text-green", solid: "bg-green text-white", ink: "bg-ink text-white" }[tone];
  return (
    <li className="grid grid-cols-[40px_1fr] gap-4">
      <div className="flex flex-col items-center">
        <span className={`grid size-10 flex-none place-items-center rounded-full ${t}`}><Icon name={icon} size={18} /></span>
        {!last && <span className="w-0.5 flex-1 bg-line" />}
      </div>
      <div className="mb-6 flex flex-col gap-3 rounded-md border border-line bg-white p-5">
        <div className="text-sm">
          <b>{who}</b> {title} {when && <span className="text-ink-muted">· {when}</span>}
        </div>
        {children}
      </div>
    </li>
  );
}
