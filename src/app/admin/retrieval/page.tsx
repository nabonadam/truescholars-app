import type { Metadata } from "next";
import Link from "next/link";
import { AdminTabs } from "@/components/AdminTabs";
import { AddRetrieverForm, AssignForm, RemoveRetrieverButton, UnassignButton } from "@/components/lit/RetrievalAdminForms";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { requireUser } from "@/server/guards";
import { markLinkNotificationsRead } from "@/server/notifications";
import type { Brief } from "@/server/lit";
import { listRetrievalRequests, listRetrievers } from "@/server/litRetrieval";

export const metadata: Metadata = { title: "Literature retrieval requests" };
export const dynamic = "force-dynamic";

const PER_PAPER = 20; // placeholder price per paper (GH₵) until real pricing is set

const STAGE: Record<string, { text: string; tone: string }> = {
  REQUESTED: { text: "Needs an expert", tone: "bg-amber text-ink" },
  RETRIEVAL: { text: "With the expert", tone: "bg-green-tint text-green" },
  REVIEWING: { text: "Client reviewing", tone: "bg-amber-tint text-amber-deep" },
  ANALYSIS: { text: "Accepted", tone: "bg-line text-ink-muted" },
  DRAFT: { text: "Withdrawn", tone: "bg-line text-ink-muted" },
};

export default async function AdminRetrieval() {
  const admin = await requireUser("ADMIN");
  const db = getDb();
  await markLinkNotificationsRead(db, admin.id, "/admin/retrieval");
  const [rows, retrievers] = await Promise.all([listRetrievalRequests(db), listRetrievers(db)]);
  const open = rows.filter((r) => r.status === "REQUESTED");
  const rest = rows.filter((r) => r.status !== "REQUESTED" && r.status !== "DRAFT");
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Admin</span>
        <h1 className="text-3xl font-bold">Literature retrieval</h1>
        <p className="max-w-3xl text-ink-muted">
          Requests from the Literature Review tool come here privately; they are never posted on the job board. Assign each one to a literature retriever with a price. The client then pays into escrow, and only the assigned expert sees the research question.
        </p>
      </div>
      <AdminTabs active="/admin/retrieval" counts={{ "/admin/retrieval": open.length }} />

      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-extrabold">Waiting for an expert {open.length > 0 && <span className="ml-1 rounded-full bg-amber px-2.5 py-0.5 text-sm">{open.length}</span>}</h2>
        {open.map((r) => {
          const b = (r.brief ?? {}) as Brief;
          const papers = b.papersWanted ?? 20;
          const brief: [string, string | number | undefined][] = [["Papers wanted", papers], ["Purpose", b.purpose], ["Discipline", b.discipline], ["Years", b.years], ["Regions", b.regions], ["Languages", b.languages], ["Include", b.include], ["Exclude", b.exclude], ["Notes", b.notes]];
          return (
            <article key={r.id} className="card grid gap-5 p-5 lg:grid-cols-[1fr_1.1fr]">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
                  <span className="rounded-full bg-amber px-2.5 py-0.5 text-xs font-bold text-ink">Needs an expert</span>
                  <span>{r.owner} · {r.ownerEmail}</span>
                  <span>· {r.requestedAt ? ago(r.requestedAt) : ""}</span>
                </div>
                <h3 className="mt-2 text-lg font-extrabold">{r.title}</h3>
                <p className="mt-1 text-[15px] font-bold">{r.researchQuestion}</p>
                <dl className="mt-2 space-y-0.5 text-[13.5px]">
                  {brief.filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><dt className="inline font-bold">{k}: </dt><dd className="inline text-ink-muted">{v}</dd></div>
                  ))}
                  <div><dt className="inline font-bold">Needed within: </dt><dd className="inline text-ink-muted">{r.requestDays ?? 7} days</dd></div>
                </dl>
              </div>
              <AssignForm reviewId={r.id} retrievers={retrievers} price={papers * PER_PAPER} days={r.requestDays ?? 7} />
            </article>
          );
        })}
        {!open.length && <p className="card p-6 text-center text-ink-muted">No requests waiting. New ones appear here, and you get a notification.</p>}
      </div>

      {rest.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-extrabold">Assigned</h2>
          <div className="overflow-x-auto rounded-md border border-line bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-parchment text-left text-xs tracking-wide text-ink-muted uppercase">
                <tr>
                  <th className="px-4 py-3">Review</th>
                  <th className="px-4 py-3">Expert</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Papers</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rest.map((r) => {
                  const st = STAGE[r.status] ?? STAGE.DRAFT;
                  return (
                    <tr key={r.id} className="border-t border-line align-top">
                      <td className="px-4 py-3">
                        <div className="font-bold">{r.title}</div>
                        <div className="text-xs text-ink-muted">{r.owner} · assigned {r.assignedAt ? ago(r.assignedAt) : ""}</div>
                      </td>
                      <td className="px-4 py-3">{r.expert ?? "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${st.tone}`}>{st.text}</span>
                        {r.status === "RETRIEVAL" && !r.paid && <span className="ml-1.5 rounded-full bg-line px-2.5 py-0.5 text-xs font-bold whitespace-nowrap text-ink-muted">Awaiting payment</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.total ? formatMoney(r.total) : "-"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.papers}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          {r.orderId && <Link href={`/orders/${r.orderId}`} className="text-xs font-bold text-green">Order ↗</Link>}
                          {r.status === "RETRIEVAL" && !r.paid && <UnassignButton reviewId={r.id} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="card p-5">
          <h2 className="text-lg font-extrabold">Literature retrievers ({retrievers.length})</h2>
          <p className="text-[13px] text-ink-muted">Experts who chose to take private literature retrieval assignments, in their application or their expert profile.</p>
          <ul className="mt-3 divide-y divide-line">
            {retrievers.map((x) => (
              <li key={x.userId} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{x.name ?? x.email}</span>
                  <span className="block truncate text-xs text-ink-muted">{x.headline} · {x.email}</span>
                </span>
                <span className="text-xs text-ink-muted whitespace-nowrap">{x.active} active · {x.done} done</span>
                <RemoveRetrieverButton userId={x.userId} />
              </li>
            ))}
            {!retrievers.length && <li className="py-3 text-sm text-ink-muted">None yet.</li>}
          </ul>
        </div>
        <div className="card p-5">
          <h2 className="text-lg font-extrabold">Add a retriever</h2>
          <p className="mb-3 text-[13px] text-ink-muted">Any approved expert, by the email they signed up with.</p>
          <AddRetrieverForm />
        </div>
      </div>
    </section>
  );
}
