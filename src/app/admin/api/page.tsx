import type { Metadata } from "next";
import { AdminTabs } from "@/components/AdminTabs";
import { ApiGrantForm } from "@/components/ApiGrantForm";
import { getDb } from "@/db";
import { listApiSubscribers } from "@/server/apiAccess";
import { requireUser } from "@/server/guards";

export const metadata: Metadata = { title: "API plan" };
export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "never");

export default async function AdminApi() {
  await requireUser("ADMIN");
  const rows = await listApiSubscribers(getDb());
  const now = new Date();
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Admin</span>
        <h1 className="text-3xl font-bold">Qualitative Studio API</h1>
        <p className="text-ink-muted">People who pay for the API plan appear here automatically. Switch it on by hand for organisations you invoice, or to test; this also gives them the Qualitative Studio for the same time.</p>
      </div>
      <AdminTabs active="/admin/api" />
      <ApiGrantForm />
      <div className="overflow-x-auto rounded-sm border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-parchment"><tr><th className="p-3">Account</th><th className="p-3">Plan</th><th className="p-3">Active keys</th><th className="p-3">Last API call</th><th className="p-3">Note</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-t border-line">
                <td className="p-3"><b>{r.name ?? "—"}</b><span className="block text-ink-muted">{r.email}</span></td>
                <td className="p-3">{r.until > now ? <span className="rounded-full bg-green-tint px-2 py-0.5 font-bold text-green">Until {day(r.until)}</span> : <span className="rounded-full bg-line px-2 py-0.5 font-bold text-ink-muted">Ended {day(r.until)}</span>}</td>
                <td className="p-3">{r.keys}</td>
                <td className="p-3">{day(r.lastUsed)}</td>
                <td className="p-3 text-ink-muted">{r.note ?? ""}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="p-6 text-center text-ink-muted">No API subscribers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
