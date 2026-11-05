import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/guards";
import { listOrdersForUser } from "@/server/orders";
import { ORDER_STATUS } from "@/lib/status";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function Orders() {
  const user = await requireUser();
  const rows = await listOrdersForUser(getDb(), user.id);
  const buying = rows.filter((r) => r.clientId === user.id);
  const selling = rows.filter((r) => r.expertId === user.id);

  const List = ({ items, empty }: { items: typeof rows; empty: React.ReactNode }) =>
    items.length === 0 ? (
      <div className="card text-ink-muted">{empty}</div>
    ) : (
      <ul className="flex flex-col gap-3">
        {items.map((o) => (
          <li key={o.id}>
            <Link href={`/orders/${o.id}`} className="card flex flex-wrap items-center gap-3 text-ink no-underline hover:shadow-md">
              <div className="min-w-0 flex-1">
                <div className="font-bold">{o.title}</div>
                <div className="text-sm text-ink-muted">
                  {o.tier ? `${o.tier.charAt(0)}${o.tier.slice(1).toLowerCase()} · ` : ""}
                  {o.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </div>
              </div>
              <span className="font-display font-bold">{formatMoney(o.totalMinor, o.currency)}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${ORDER_STATUS[o.status].tone}`}>{ORDER_STATUS[o.status].label}</span>
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Orders</span>
        <h1 className="text-3xl font-bold">Your orders</h1>
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Buying</h2>
        <List items={buying} empty={<>No orders yet. <Link href="/services" className="font-bold text-green">Find an expert</Link></>} />
      </div>
      {user.roles.includes("EXPERT") && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">Selling</h2>
          <List items={selling} empty="No orders from clients yet." />
        </div>
      )}
    </section>
  );
}
