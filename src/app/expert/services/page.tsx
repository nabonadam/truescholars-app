import type { Metadata } from "next";
import Link from "next/link";
import { toggleServiceAction } from "@/app/actions/services";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/guards";
import { listServicesForExpert } from "@/server/services";

export const metadata: Metadata = { title: "My services" };
export const dynamic = "force-dynamic";

export default async function MyServices() {
  const user = await requireUser("EXPERT");
  const rows = await listServicesForExpert(getDb(), user.id);

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Expert</span>
          <h1 className="text-3xl font-bold">My services</h1>
        </div>
        <Link href="/expert/services/new" className="btn-primary">Create a service</Link>
      </div>

      {rows.length === 0 ? (
        <div className="card flex flex-col items-start gap-3">
          <h2 className="text-xl font-bold">Package your expertise</h2>
          <p className="text-ink-muted">Create a service with clear packages so clients can buy straight away. Most experts start with one service in their strongest field.</p>
          <Link href="/expert/services/new" className="btn-primary">Create your first service</Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((s) => (
            <li key={s.id} className="card flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <Link href={`/services/${s.id}`} className="font-bold text-green">{s.title}</Link>
                <div className="text-sm text-ink-muted">{s.categoryName} · from {formatMoney(s.fromMinor)}</div>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${s.status === "ACTIVE" ? "bg-green-tint text-green" : "bg-line text-ink-muted"}`}>
                {s.status === "ACTIVE" ? "Live" : "Paused"}
              </span>
              <Link href={`/expert/services/${s.id}/edit`} className="btn-outline border border-line">Edit</Link>
              <form action={toggleServiceAction}>
                <input type="hidden" name="serviceId" value={s.id} />
                <input type="hidden" name="status" value={s.status === "ACTIVE" ? "PAUSED" : "ACTIVE"} />
                <button className="btn-outline border border-line">{s.status === "ACTIVE" ? "Pause" : "Resume"}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
