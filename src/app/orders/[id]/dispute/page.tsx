import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icons";
import { OpenDisputeForm } from "@/components/TrustForms";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { hasOpenDispute } from "@/server/disputes";
import { requireUser } from "@/server/guards";
import { getOrderForUser } from "@/server/orders";

export const metadata: Metadata = { title: "Open a dispute" };
export const dynamic = "force-dynamic";

export default async function NewDispute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { m } = await searchParams;
  const db = getDb();
  const data = await getOrderForUser(db, id, user.id);
  if (!data || data.role === "admin") notFound();
  const milestone = data.milestones.find((x) => x.id === m) ?? data.milestones.find((x) => ["FUNDED", "DELIVERED", "REVISION_REQUESTED"].includes(x.status));
  const other = data.role === "client" ? data.expert : data.client;
  const eligible = milestone && ["FUNDED", "DELIVERED", "REVISION_REQUESTED"].includes(milestone.status) && !(await hasOpenDispute(db, milestone.id));

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <Link href={`/orders/${id}`} className="text-sm font-bold text-green">← Back to the order</Link>
      <div>
        <span className="eyebrow">Resolution centre</span>
        <h1 className="text-3xl font-bold">Open a dispute</h1>
        <p className="text-ink-muted">{data.order.title}{milestone ? ` · ${milestone.title} · ${formatMoney(milestone.amountMinor, data.order.currency)} in escrow` : ""}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: "message" as const, title: "Talk first", body: `Most problems are fixed with a clear message to ${other.name?.split(" ")[0] ?? "the other side"}.` },
          { icon: "lock" as const, title: "Money stays safe", body: "A dispute freezes the payment in escrow. Nobody can move it." },
          { icon: "scale" as const, title: "Fair outcome", body: "Agree a split together, or our team decides after reviewing everything." },
        ].map((s) => (
          <div key={s.title} className="flex flex-col gap-2 rounded-md border border-line bg-white p-4">
            <span className="grid size-9 place-items-center rounded-full bg-green-tint text-green"><Icon name={s.icon} size={18} /></span>
            <div className="font-bold">{s.title}</div>
            <p className="text-sm text-ink-muted">{s.body}</p>
          </div>
        ))}
      </div>

      {eligible && milestone ? (
        <div className="card">
          <OpenDisputeForm orderId={id} milestoneId={milestone.id} />
        </div>
      ) : (
        <div className="card flex flex-col gap-3">
          <h2 className="text-xl font-bold">There&apos;s nothing to dispute right now</h2>
          <p className="text-ink-muted">You can open a dispute while a milestone&apos;s payment is held in escrow and no other dispute is open on it.</p>
          <Link href={`/messages?c=${id}`} className="btn-primary self-start">Message {other.name?.split(" ")[0]}</Link>
        </div>
      )}
    </section>
  );
}
