import type { Metadata } from "next";
import Link from "next/link";
import { startTestPayment } from "@/app/actions/payments";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { isTestMode, paystackConfigured } from "@/lib/paystack";
import { ORDER_STATUS } from "@/lib/status";
import { expertAvailable } from "@/server/escrow";
import { requireUser } from "@/server/guards";
import { listFlaggedMessages } from "@/server/orderRoom";
import { clientEscrowTotal, listOrdersForUser } from "@/server/orders";
import { listServicesForExpert } from "@/server/services";
import { getApplicationForUser, listApplications } from "@/server/vetting";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const APP_STATUS: Record<string, string> = {
  SUBMITTED: "Application received: awaiting review",
  IN_REVIEW: "Application under review",
  REJECTED: "Not approved yet: you can update and reapply",
};
const OPEN = ["AWAITING_PAYMENT", "ACTIVE", "DELIVERED", "DISPUTED"];

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card flex flex-col gap-1">
      <span className="text-sm font-bold text-ink-muted">{label}</span>
      <span className="font-display text-3xl font-bold">{value}</span>
      <span className="text-sm text-ink-muted">{note}</span>
    </div>
  );
}

function Step({ n, title, body, done }: { n: number; title: string; body: string; done?: boolean }) {
  return (
    <li className="flex gap-3">
      <span
        className={`grid size-9 flex-none place-items-center rounded-full font-display font-bold ${done ? "bg-green text-white" : "border-2 border-green text-green"}`}
        aria-hidden="true"
      >
        {done ? "✓" : n}
      </span>
      <div>
        <div className="font-bold">{title}{done && <span className="sr-only"> (done)</span>}</div>
        <p className="text-sm text-ink-muted">{body}</p>
      </div>
    </li>
  );
}

export default async function Dashboard() {
  const user = await requireUser();
  const db = getDb();
  const isExpert = user.roles.includes("EXPERT");
  const isAdmin = user.roles.includes("ADMIN");

  const [orders, inEscrow, available, services, application, openApps, flagged] = await Promise.all([
    listOrdersForUser(db, user.id),
    clientEscrowTotal(db, user.id),
    isExpert ? expertAvailable(db, user.id) : Promise.resolve(0),
    isExpert ? listServicesForExpert(db, user.id) : Promise.resolve([]),
    isExpert ? Promise.resolve(null) : getApplicationForUser(db, user.id),
    isAdmin ? listApplications(db).then((r) => r.filter((a) => a.status === "SUBMITTED" || a.status === "IN_REVIEW").length) : Promise.resolve(0),
    isAdmin ? listFlaggedMessages(db).then((r) => r.length) : Promise.resolve(0),
  ]);

  const buying = orders.filter((o) => o.clientId === user.id);
  const selling = orders.filter((o) => o.expertId === user.id);
  const activeBuying = buying.filter((o) => OPEN.includes(o.status)).length;
  const activeSelling = selling.filter((o) => OPEN.includes(o.status)).length;
  const liveServices = services.filter((s) => s.status === "ACTIVE").length;
  const firstName = user.name?.split(" ")[0] ?? "there";
  const recent = orders.slice(0, 4);
  const isNewClient = !isExpert && buying.length === 0;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Dashboard</span>
        <h1 className="text-3xl font-bold sm:text-4xl">Welcome, {firstName}</h1>
        <div className="flex flex-wrap gap-2">
          {user.roles.map((r) => (
            <span key={r} className="rounded-full bg-green-tint px-3 py-1 text-xs font-bold text-green">
              {r.charAt(0) + r.slice(1).toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {/* New client: how it works */}
      {isNewClient && (
        <div className="card flex flex-col gap-5 border-green">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-bold">Get research help in three steps</h2>
            <p className="text-ink-muted">Every expert is vetted, and your money is protected until you&apos;re happy with the work.</p>
          </div>
          <ol className="grid gap-5 md:grid-cols-3">
            <Step n={1} title="Find an expert" body="Browse vetted statisticians, editors and methodologists, and pick a package." />
            <Step n={2} title="Pay into escrow" body="Pay by Mobile Money or card. The expert isn't paid until you approve." />
            <Step n={3} title="Approve and review" body="Get your delivery, ask for revisions if needed, then approve and rate." />
          </ol>
          <Link href="/services" className="btn-primary self-start">Find an expert</Link>
        </div>
      )}

      {/* Expert setup checklist until the first sale */}
      {isExpert && selling.length === 0 && (
        <div className="card flex flex-col gap-5 border-green">
          <h2 className="text-2xl font-bold">Set up to get your first order</h2>
          <ol className="grid gap-5 md:grid-cols-3">
            <Step n={1} title="Get vetted" body="Your credentials have been approved." done />
            <Step n={2} title="Publish a service" body="Package your expertise with clear prices and delivery times." done={liveServices > 0} />
            <Step n={3} title="Deliver your first order" body="Clients pay into escrow; you're paid when they approve." />
          </ol>
          {liveServices === 0 && <Link href="/expert/services/new" className="btn-primary self-start">Create your first service</Link>}
        </div>
      )}

      {/* Numbers */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {isExpert ? (
          <>
            <Stat label="Earnings available" value={formatMoney(available)} note="Released to you from approved work" />
            <Stat label="Active sales" value={String(activeSelling)} note={`${selling.length} order${selling.length === 1 ? "" : "s"} in total`} />
            <Stat label="Live services" value={String(liveServices)} note={`${services.length} created`} />
          </>
        ) : null}
        <Stat label="In escrow" value={formatMoney(inEscrow)} note="Held safely until you approve" />
        {!isExpert && <Stat label="Active orders" value={String(activeBuying)} note={`${buying.length} order${buying.length === 1 ? "" : "s"} in total`} />}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Recent orders */}
        <div className="card flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Recent orders</h2>
            {orders.length > 0 && <Link href="/orders" className="text-sm font-bold text-green">See all →</Link>}
          </div>
          {recent.length === 0 ? (
            <p className="text-ink-muted">
              No orders yet.{" "}
              {isExpert ? "Once a client buys one of your services, it appears here." : <Link href="/services" className="font-bold text-green">Find an expert</Link>}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="flex flex-wrap items-center gap-3 py-3 text-ink no-underline">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{o.title}</div>
                      <div className="text-xs text-ink-muted">{o.clientId === user.id ? "Buying" : "Selling"}</div>
                    </div>
                    <span className="font-display font-bold">{formatMoney(o.totalMinor, o.currency)}</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${ORDER_STATUS[o.status].tone}`}>{ORDER_STATUS[o.status].label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Side panel */}
        <div className="flex flex-col gap-5">
          {isExpert ? (
            <div className="card flex flex-col gap-3">
              <span className="text-sm font-bold text-ink-muted">Your services</span>
              <p>Keep your packages clear and up to date. It&apos;s what clients compare.</p>
              <Link href="/expert/services" className="btn-primary">My services</Link>
            </div>
          ) : (
            <div className="card flex flex-col gap-3">
              <span className="text-sm font-bold text-ink-muted">Become an expert</span>
              <p>{application ? APP_STATUS[application.status] : "Are you a statistician, editor or methodologist? Apply to join our vetted network."}</p>
              <Link href="/apply" className="btn-outline">{application ? "View application" : "Apply now"}</Link>
            </div>
          )}

          {isAdmin && (
            <div className="card flex flex-col gap-3 border-green">
              <span className="text-sm font-bold text-ink-muted">Admin</span>
              <Link href="/admin/applications" className="flex items-center justify-between font-bold text-green no-underline">
                Expert applications <span className="rounded-full bg-amber-tint px-3 py-1 text-xs text-amber-deep">{openApps} to review</span>
              </Link>
              <Link href="/admin/messages" className="flex items-center justify-between font-bold text-green no-underline">
                Flagged messages <span className="rounded-full bg-amber-tint px-3 py-1 text-xs text-amber-deep">{flagged}</span>
              </Link>
            </div>
          )}

          {isAdmin && paystackConfigured() && isTestMode() && (
            <div className="card flex flex-col gap-3">
              <span className="text-sm font-bold text-ink-muted">Admin · Payments check (test mode)</span>
              <p className="text-sm">Make a GH₵1 Paystack test payment. Only admins see this.</p>
              <form action={startTestPayment}>
                <button className="btn-outline w-full border border-line">Run a test payment</button>
              </form>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
