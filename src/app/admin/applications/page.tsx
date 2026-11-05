import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { listApplications } from "@/server/vetting";

export const metadata: Metadata = { title: "Expert applications" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "open", label: "To review" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "all", label: "All" },
] as const;

const BADGE: Record<string, string> = {
  SUBMITTED: "bg-amber-tint text-amber-deep",
  IN_REVIEW: "bg-amber-tint text-amber-deep",
  APPROVED: "bg-green-tint text-green",
  REJECTED: "bg-line text-ink-muted",
};

export default async function AdminApplications({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser("ADMIN");
  const { show = "open" } = await searchParams;
  const all = await listApplications(getDb());
  const rows = all.filter((r) =>
    show === "all" ? true : show === "open" ? r.status === "SUBMITTED" || r.status === "IN_REVIEW" : r.status === show,
  );

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Admin</span>
        <h1 className="text-3xl font-bold">Expert applications</h1>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Filter applications">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/applications?show=${f.key}`}
            className={`rounded-full px-4 py-2 text-sm font-bold no-underline ${show === f.key ? "bg-green text-white" : "border border-line bg-white text-ink"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="card text-ink-muted">No applications here yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-bold">Applicant</th>
                <th className="px-4 py-3 font-bold">Qualification</th>
                <th className="px-4 py-3 font-bold">Fields</th>
                <th className="px-4 py-3 font-bold">Submitted</th>
                <th className="px-4 py-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/applications/${r.id}`} className="font-bold text-green">{r.name ?? r.email}</Link>
                    <div className="text-xs text-ink-muted">{r.email}</div>
                  </td>
                  <td className="px-4 py-3">{r.qualification} · {r.experienceYears} yrs</td>
                  <td className="px-4 py-3">{r.fields.join(", ")}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${BADGE[r.status]}`}>{r.status.replace("_", " ").toLowerCase()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
