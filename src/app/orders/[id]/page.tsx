import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { payOrderAction } from "@/app/actions/orders";
import { AutoRefresh, ClientDecision, DeliveryForm, MessageComposer, ReviewForm } from "@/components/OrderRoomForms";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS } from "@/lib/status";
import { fileMeta, formatBytes } from "@/server/files";
import { requireUser } from "@/server/guards";
import { autoApproveDue, listDeliveries, listMessages, reviewsForOrder } from "@/server/orderRoom";
import { getOrderForUser } from "@/server/orders";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

const MILESTONE: Record<string, string> = {
  PENDING_FUNDING: "Awaiting payment",
  FUNDED: "Paid into escrow · in progress",
  DELIVERED: "Delivered · awaiting the client's approval",
  REVISION_REQUESTED: "Revision requested",
  APPROVED: "Approved · paid to the expert",
  REFUNDED: "Refunded to the client",
};

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function FileLinks({ ids, meta }: { ids: string[]; meta: Map<string, { name: string; sizeBytes: number }> }) {
  if (ids.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {ids.map((id) => {
        const f = meta.get(id);
        return f ? (
          <li key={id}>
            <a href={`/api/files/${id}`} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm font-bold text-green no-underline">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
              {f.name} <span className="font-normal text-ink-muted">{formatBytes(f.sizeBytes)}</span>
            </a>
          </li>
        ) : null;
      })}
    </ul>
  );
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  await autoApproveDue(db); // so an overdue approval never waits on a scheduler
  const data = await getOrderForUser(db, id, user.id);
  if (!data) notFound();
  const { order, milestones, client, expert, role } = data;

  const [msgs, dels, revs] = await Promise.all([
    listMessages(db, order.id),
    listDeliveries(db, milestones.map((m) => m.id)),
    reviewsForOrder(db, order.id),
  ]);
  const meta = new Map((await fileMeta(db, [...msgs.flatMap((m) => m.files), ...dels.flatMap((d) => d.files)])).map((f) => [f.id, f]));
  const answers = (order.requirements as { question: string; answer: string }[] | null) ?? [];
  const status = ORDER_STATUS[order.status];
  const other = role === "client" ? expert : client;
  const myReview = revs.find((r) => r.authorId === user.id);
  const theirReview = revs.find((r) => r.authorId !== user.id);
  const expertFirst = expert.name?.split(" ")[0] ?? "the expert";

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <AutoRefresh />
      <Link href="/orders" className="text-sm font-bold text-green">← All orders</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Order</span>
          <h1 className="text-2xl font-bold sm:text-3xl">{order.title}</h1>
          <p className="text-ink-muted">
            {role === "client" ? `with ${expert.name}` : `for ${client.name}`} · {formatMoney(order.totalMinor, order.currency)} · opened {fmtDate(order.createdAt)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${status.tone}`}>{status.label}</span>
      </div>

      {order.status === "AWAITING_PAYMENT" && role === "client" && (
        <div className="card flex flex-wrap items-center gap-4 border-amber bg-amber-tint">
          <p className="flex-1 text-amber-deep">Your order starts once payment is in escrow.</p>
          <form action={payOrderAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="btn-primary">Pay now</button>
          </form>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        {/* Work: milestones, deliveries and decisions */}
        <div className="flex flex-col gap-6">
          {milestones.map((m) => {
            const mDels = dels.filter((d) => d.milestoneId === m.id);
            const revisionsLeft = m.revisionsAllowed - m.revisionsUsed;
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

                {role === "expert" && (m.status === "FUNDED" || m.status === "REVISION_REQUESTED") && (
                  <div className="border-t border-line pt-4">
                    <DeliveryForm orderId={order.id} milestoneId={m.id} />
                  </div>
                )}

                {m.status === "DELIVERED" && (
                  <div className="flex flex-col gap-2 border-t border-line pt-4">
                    {role === "client" ? (
                      <>
                        <p className="text-sm text-ink-muted">
                          Check the delivery. Approving releases {formatMoney(m.amountMinor, order.currency)} from escrow to {expertFirst}.
                          {m.autoApproveAt ? ` If you don't respond, it's approved automatically on ${fmtDate(m.autoApproveAt)}.` : ""}
                        </p>
                        <ClientDecision orderId={order.id} milestoneId={m.id} revisionsLeft={revisionsLeft} expertFirstName={expertFirst} />
                      </>
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

          {order.status === "COMPLETED" && (
            <div className="card flex flex-col gap-4">
              <h2 className="text-xl font-bold">Reviews</h2>
              {myReview ? (
                <p className="text-sm text-ink-muted">You rated this order {"★".repeat(myReview.rating)}{myReview.body ? `: “${myReview.body}”` : "."}</p>
              ) : (
                <ReviewForm orderId={order.id} subjectName={other.name?.split(" ")[0] ?? "them"} />
              )}
              {theirReview && (
                <p className="text-sm text-ink-muted">
                  {other.name?.split(" ")[0]} rated you {"★".repeat(theirReview.rating)}{theirReview.body ? `: “${theirReview.body}”` : "."}
                </p>
              )}
            </div>
          )}

          {answers.length > 0 && (
            <details className="card">
              <summary className="cursor-pointer text-lg font-bold">Project details from the client</summary>
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
        <div className="card flex flex-col gap-4 lg:sticky lg:top-4">
          <h2 className="text-xl font-bold">Messages with {other.name?.split(" ")[0] ?? "them"}</h2>
          <ol className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto" aria-live="polite">
            {msgs.length === 0 && <li className="text-sm text-ink-muted">No messages yet. Say hello and share anything that helps get started.</li>}
            {msgs.map((m) => {
              const mine = m.senderId === user.id;
              return (
                <li key={m.id} className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
                  {m.body && (
                    <div className={`max-w-[90%] rounded-md px-4 py-2 text-sm ${mine ? "bg-green text-white" : "bg-parchment text-ink"}`}>
                      <p className="whitespace-pre-line">{m.body}</p>
                    </div>
                  )}
                  <FileLinks ids={m.files} meta={meta} />
                  <span className="text-xs text-ink-muted">{mine ? "You" : m.senderName} · {fmtTime(m.createdAt)}</span>
                </li>
              );
            })}
          </ol>
          {order.status !== "CANCELLED" && <MessageComposer orderId={order.id} />}
          <p className="text-xs text-ink-muted">Keep communication and payment on The True Scholars: it&apos;s what protects you if something goes wrong.</p>
        </div>
      </div>
    </section>
  );
}
