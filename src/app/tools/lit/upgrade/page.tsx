import Link from "next/link";
import { Icon } from "@/components/Icons";
import { LitUpgradeButton } from "@/components/lit/NewReview";
import { PlanPicker } from "@/components/PlanPicker";
import { getDb } from "@/db";
import { isTestMode, paystackConfigured } from "@/lib/paystack";
import { currencyForCountry } from "@/lib/plans";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { usdToGhs } from "@/server/fx";
import { requireUser } from "@/server/guards";
import { peekToolAccess, timeLeft } from "@/server/toolAccess";

export const metadata = { title: "Upgrade Literature Review" };
export const dynamic = "force-dynamic";

const FEATURES = [
  "Unlimited reviews and papers",
  "Systematic reading of every paper, with checked quotes and page numbers",
  "Synthesis: themes, agreements, contradictions, gaps and a concept glossary",
  "Critical, idea-led writing with every sentence linked to its source",
  "Word, Excel, RIS and BibTeX exports in APA, Harvard, MLA, Chicago or Vancouver",
];

export default async function Upgrade() {
  const user = await requireUser();
  const [[me], fx] = await Promise.all([getDb().select({ country: users.country }).from(users).where(eq(users.id, user.id)), usdToGhs(getDb())]);
  const { access, upgradeRequestedAt } = await peekToolAccess(getDb(), "lit", user);
  const status =
    access.kind === "admin" ? "You have unlimited access as an admin." :
    access.kind === "trial" ? `You're on the free trial: ${timeLeft(access.endsAt)} left.` :
    access.kind === "granted" ? `You have access until ${access.endsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.` :
    access.kind === "new" ? "You haven't started your free trial yet." : "Your free trial has ended.";
  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href="/tools/lit" className="text-sm font-bold text-green no-underline">‹ Literature Review</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="relative overflow-hidden rounded-lg bg-green-deep p-7 text-white sm:p-9">
          <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-amber/15" aria-hidden="true" />
          <span className="relative inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-bold text-amber"><Icon name="book" size={14} /> Literature Review Pro</span>
          <h1 className="relative mt-4 text-[34px] leading-tight font-extrabold sm:text-[40px]">Keep reviewing.<br /><span className="text-amber">Write it critically.</span></h1>
          <ul className="relative mt-6 space-y-2.5">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[15px] text-on-green-muted"><Icon name="check" size={18} className="mt-0.5 flex-none text-amber" /> {f}</li>
            ))}
          </ul>
        </div>
        <div className="card flex flex-col gap-4 p-7">
          <span className="eyebrow">Your access</span>
          <p className="text-lg font-bold">{status}</p>
          {access.kind === "admin" && <p className="rounded-sm bg-parchment p-2.5 text-[13px] text-ink-muted">Preview: this is what clients see. You don&apos;t need to pay.</p>}
          {(paystackConfigured() ? <PlanPicker tool="lit" testMode={isTestMode()} initialCurrency={currencyForCountry(me?.country)} usdToGhs={fx.rate} /> : <p className="text-ink-muted">Online payment is being switched on. For now, ask us and we&apos;ll switch your access on and send payment details (Mobile Money or card) to <b>{user.email}</b>.</p>)}
          {access.kind !== "admin" && (
            <details className="text-sm" open={!paystackConfigured()}>
              <summary className="cursor-pointer font-bold text-ink-muted">Ask us instead (pay by bank or invoice)</summary>
              <div className="mt-2"><LitUpgradeButton requested={!!upgradeRequestedAt} /></div>
            </details>
          )}
          {access.kind === "new" ? (
            <Link href="/tools/lit" className="btn-primary">Start your free trial first</Link>
          ) : (
            <Link href="/tools/lit" className="text-sm font-bold text-green">Back to your reviews →</Link>
          )}
        </div>
      </div>
    </section>
  );
}
