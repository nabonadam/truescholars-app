import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icons";
import { reviewForOrder } from "@/server/litRetrieval";
import { payOrderAction } from "@/app/actions/orders";
import { OrderProgress } from "@/components/OrderProgress";
import { progressStep } from "@/server/dashboard";
import { ClientDecision, LivePulse, DeliveryForm, MessageComposer } from "@/components/OrderRoomForms";
import { OrderReviews } from "@/components/OrderReviews";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS } from "@/lib/status";
import { fileMeta } from "@/server/files";
import { ChatThread, FileLinks } from "@/components/ChatThread";
import { requireUser } from "@/server/guards";
import { markOrderNotificationsRead } from "@/server/notifications";
import { autoApproveDue, listDeliveries, listMessages, markThreadRead, orderPulse, reviewsForOrder } from "@/server/orderRoom";
import { getOrderForUser } from "@/server/orders";
import { nextFundable } from "@/server/jobs";
import { disputesForOrder } from "@/server/disputes";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

const MILESTONE: Record<string, string> = {
  PENDING_FUNDING: "Not funded yet",
  FUNDED: "Paid into escrow · in progress",
  DELIVERED: "Delivered · awaiting the client's approval",
  REVISION_REQUESTED: "Revision requested",
  APPROVED: "Approved · paid to the expert",
  REFUNDED: "Refunded to the client",
};

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hired?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { hired } = await searchParams;
  const db = getDb();
  await autoApproveDue(db); // so an overdue approval never waits on a scheduler
  const data = await getOrderForUser(db, id, user.id, { admin: user.roles.includes("ADMIN") });
  if (!data) notFound();
  const { order, milestones, client, expert, role } = data;

  const [msgs, dels, revs, pulse, orderDisputes] = await Promise.all([
    listMessages(db, order.id),
    listDeliveries(db, milestones.map((m) => m.id)),
    reviewsForOrder(db, order.id),
    orderPulse(db, order.id),
    disputesForOrder(db, order.id),
  ]);
  const openDisputes = orderDisputes.filter((x) => x.status === "OPEN");
  const litReviewId = await reviewForOrder(db, order.id);
  const meta = new Map((await fileMeta(db, [...msgs.flatMap((m) => m.files), ...dels.flatMap((d) => d.files)])).map((f) => [f.id, f]));
  const answers = (order.requirements as { question: string; answer: string }[] | null) ?? [];
  const status = ORDER_STATUS[order.status];
  const other = role === "client" ? expert : client;
  const isAdminView = role === "admin";
  if (!isAdminView) await Promise.all([markThreadRead(db, order.id, user.id), markOrderNotificationsRead(db, user.id, order.id)]);
  const expertFirst = expert.name?.split(" ")[0] ?? "the expert";
  const next = nextFundable(milestones);
  const multi = milestones.length > 1;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <LivePulse url={`/api/orders/${order.id}/pulse`} initial={pulse} />
      <Link href={isAdminView ? "/admin/messages" : "/orders"} className="text-sm font-bold text-green">{isAdminView ? "← Flagged messages" : "← All orders"}</Link>
      {isAdminView && (
        <p className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">Admin view: read-only. You can see the conversation and deliveries but can&apos;t act on this order.</p>
      )}
      {litReviewId && !isAdminView && (
        <Link href={`/tools/lit/${litReviewId}`} className="flex flex-wrap items-center gap-3 rounded-md bg-green-deep px-5 py-4 text-white no-underline">
          <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-amber text-ink"><Icon name="book" size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{role === "expert" ? "Deliver in the literature workspace" : "Review the literature in your review"}</span>
            <span className="block text-sm text-on-green-muted">{role === "expert" ? "Add the papers, your relevance notes and the search log, then submit to the client." : "See each paper, its DOI and the expert's note; accept them, then submit for analysis."}</span>
          </span>
          <span className="font-bold text-amber">Open →</span>
        </Link>
      )}
      {openDisputes.map((x) => (
        <Link key={x.id} href={`/disputes/${x.id}`} className="flex flex-wrap items-center gap-3 rounded-md bg-ink px-5 py-4 text-white no-underline">
          <span className="grid size-10 flex-none place-items-center rounded-full bg-amber font-bold text-ink" aria-hidden="true">⚖</span>
          <span className="flex-1">
            <b>A dispute is open on this order.</b>{" "}
            <span className="text-on-green-muted">The payment is frozen in escrow until it&apos;s settled.</span>
          </span>
          <span className="font-bold text-amber">Open the resolution centre →</span>
        </Link>
      ))}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Order</span>
          <h1 className="text-2xl font-bold sm:text-3xl">{order.title}</h1>
          <p className="text-ink-muted">
            {isAdminView ? `${client.name} (client) and ${expert.name} (expert)` : role === "client" ? `with ${expert.name}` : `for ${client.name}`} · {formatMoney(order.totalMinor, order.currency)} · opened {fmtDate(order.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {order.status !== "AWAITING_PAYMENT" && order.status !== "CANCELLED" && (
            <Link href={`/orders/${order.id}/receipt`} className="text-sm font-bold text-green">Receipt</Link>
          )}
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${status.tone}`}>{status.label}</span>
        </div>
      </div>

      {order.status !== "AWAITING_PAYMENT" && order.status !== "CANCELLED" && (
        <div className="card">
          <OrderProgress step={progressStep(order.status, milestones.map((m) => m.status))} />
        </div>
      )}

      {!isAdminView && <OrderReviews order={order} revs={revs} userId={user.id} role={role as "client" | "expert"} otherName={other.name ?? ""} />}

      {hired && role === "client" && order.status === "AWAITING_PAYMENT" && (
        <div className="flex items-center gap-4 rounded-md bg-green p-5 text-white">
          <span className="grid size-12 flex-none place-items-center rounded-full bg-amber font-display text-xl font-bold text-ink" aria-hidden="true">✓</span>
          <div>
            <div className="font-display text-xl font-bold">You hired {expertFirst}!</div>
            <p className="text-on-green-muted">We&apos;ve let {expertFirst} know. Fund the first milestone below and the work begins. Say hello in the messages while you&apos;re here.</p>
          </div>
        </div>
      )}

      {role === "client" && next && (order.status === "AWAITING_PAYMENT" || order.status === "ACTIVE") && (
        <div className="card flex flex-wrap items-center gap-4 border-amber bg-amber-tint">
          <div className="flex-1">
            <p className="font-bold text-ink">
              {multi ? `${order.status === "AWAITING_PAYMENT" ? "Start with" : "Ready for"} milestone ${next.position} of ${milestones.length}: ${next.title}` : "Your order starts once payment is in escrow."}
            </p>
            <p className="text-sm text-amber-deep">
              {formatMoney(next.amountMinor, order.currency)} is held safely in escrow and released to {expertFirst} only when you approve the work.
            </p>
          </div>
          <form action={payOrderAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="btn-primary">{multi ? `Fund ${formatMoney(next.amountMinor, order.currency).replace(/\.00$/, "")}` : "Pay now"}</button>
          </form>
        </div>
      )}
      {role === "expert" && next && order.status === "ACTIVE" && (
        <p className="rounded-sm bg-parchment px-4 py-3 text-sm">
          Milestone {next.position} (“{next.title}”) starts once {client.name?.split(" ")[0] ?? "the client"} funds it. We&apos;ll notify you.
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        {/* Work: milestones, deliveries and decisions */}
        <div className="flex flex-col gap-6">
          {milestones.map((m) => {
            const mDels = dels.filter((d) => d.milestoneId === m.id);
            const revisionsLeft = m.revisionsAllowed - m.revisionsUsed;
            const frozen = openDisputes.some((x) => x.milestoneId === m.id);
            return (
              <div key={m.id} className="card flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold">{m.title}</h2>
                    <p className="text-sm text-ink-muted">
                      {MILESTONE[m.status]}
                      {m.dueAt && (m.status === "FUNDED" || m.status === "REVISION_REQUESTED") ? ` · due ${fmtDate(m.dueAt)}` : ""}
                      {` · ${revisionsLeft} of ${m.revisionsAllowed} revision${m.revisionsAllowed === 1 ? "" : "s"} left`}
                    </p>
                  </div>
                  <span className="font-display text-xl font-bold">{formatMoney(m.amountMinor, order.currency)}</span>
                </div>

                {mDels.map((d, i) => (
                  <div key={d.id} className="flex flex-col gap-2 rounded-sm border border-line bg-parchment p-4">
                    <div className="text-sm font-bold">
                      {i === 0 ? "Latest delivery" : "Earlier delivery"} · {fmtTime(d.createdAt)}
                    </div>
                    <p className="whitespace-pre-line text-sm">{d.note}</p>
                    <FileLinks ids={d.files} meta={meta} />
                  </div>
                ))}

                {role === "expert" && !frozen && (m.status === "FUNDED" || m.status === "REVISION_REQUESTED") && (
                  <div className="border-t border-line pt-4">
                    <DeliveryForm orderId={order.id} milestoneId={m.id} />
                  </div>
                )}

                {!isAdminView && ["FUNDED", "DELIVERED", "REVISION_REQUESTED"].includes(m.status) && !frozen && (
                  <Link href={`/orders/${order.id}/dispute?m=${m.id}`} className="order-last self-start text-xs font-bold text-ink-muted">
                    Problem with this milestone? Open a dispute
                  </Link>
                )}
                {frozen && <p className="rounded-sm bg-parchment px-4 py-3 text-sm font-bold">In dispute: actions are paused until it&apos;s settled.</p>}
                {m.status === "DELIVERED" && !frozen && (
                  <div className="flex flex-col gap-2 border-t border-line pt-4">
                    {role === "client" ? (
                      <>
                        <p className="text-sm text-ink-muted">
                          Check the delivery. Approving releases {formatMoney(m.amountMinor, order.currency)} from escrow to {expertFirst}.
                          {m.autoApproveAt ? ` If you don't respond, it's approved automatically on ${fmtDate(m.autoApproveAt)}.` : ""}
                        </p>
                        <ClientDecision orderId={order.id} milestoneId={m.id} revisionsLeft={revisionsLeft} expertFirstName={expertFirst} />
                      </>
                    ) : isAdminView ? (
                      <p className="text-sm text-ink-muted">Delivered; waiting for the client&apos;s decision.</p>
                    ) : (
                      <p className="text-sm text-ink-muted">
                        Waiting for {client.name?.split(" ")[0] ?? "the client"} to approve.
                        {m.autoApproveAt ? ` Approved automatically on ${fmtDate(m.autoApproveAt)} if they don't respond.` : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {answers.length > 0 && (
            <details className="card">
              <summary className="cursor-pointer text-lg font-bold">{order.proposalId ? "The job and the proposal" : "Project details from the client"}</summary>
              <div className="mt-4 flex flex-col gap-4">
                {answers.map((a) => (
                  <div key={a.question}>
                    <div className="text-sm font-bold text-ink-muted">{a.question}</div>
                    <p className="whitespace-pre-line">{a.answer}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Conversation */}
        <div id="messages" className="card flex scroll-mt-4 flex-col gap-4 lg:sticky lg:top-4">
          <h2 className="text-xl font-bold">{isAdminView ? "Conversation" : `Messages with ${other.name?.split(" ")[0] ?? "them"}`}</h2>
          <ChatThread msgs={msgs} meta={meta} viewerId={user.id} className="max-h-[28rem]" empty="No messages yet. Say hello and share anything that helps get started." />
          {order.status !== "CANCELLED" && !isAdminView && <MessageComposer orderId={order.id} />}
          <p className="text-xs text-ink-muted">Keep communication and payment on The True Scholars: it&apos;s what protects you if something goes wrong.</p>
        </div>
      </div>
    </section>
  );
}
