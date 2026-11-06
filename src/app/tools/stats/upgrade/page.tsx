import Link from "next/link";
import { Icon } from "@/components/Icons";
import { UpgradeButton } from "@/components/stats/UpgradeButton";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { peekAccess, timeLeft } from "@/server/statsAccess";

export const metadata = { title: "Upgrade the Statistics Assistant" };
export const dynamic = "force-dynamic";

const FEATURES = [
  "Unlimited analyses in plain English or Stata",
  "Stata-style output and APA 7 tables for every result",
  "Word and Excel exports, do-files and working data",
  "Plain-English write-ups of your results",
  "Datasets up to 100 MB: Stata, SPSS, Excel and CSV",
];

export default async function Upgrade() {
  const user = await requireUser();
  const { access, upgradeRequestedAt } = await peekAccess(getDb(), user);
  const status =
    access.kind === "admin" ? "You have unlimited access as an admin." :
    access.kind === "trial" ? `You're on the free trial: ${timeLeft(access.endsAt)} left.` :
    access.kind === "granted" ? `You have access until ${access.endsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.` :
    access.kind === "new" ? "You haven't started your free trial yet." : "Your free trial has ended.";
  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href="/tools/stats" className="text-sm font-bold text-green no-underline">‹ Statistics Assistant</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="relative overflow-hidden rounded-lg bg-green-deep p-7 text-white sm:p-9">
          <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-amber/15" aria-hidden="true" />
          <span className="relative inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-bold text-amber"><Icon name="chart" size={14} /> Statistics Assistant Pro</span>
          <h1 className="relative mt-4 text-[34px] leading-tight font-extrabold sm:text-[40px]">Keep analysing.<br /><span className="text-amber">Finish your thesis faster.</span></h1>
          <ul className="relative mt-6 space-y-2.5">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[15px] text-on-green-muted"><Icon name="check" size={18} className="mt-0.5 flex-none text-amber" /> {f}</li>
            ))}
          </ul>
        </div>
        <div className="card flex flex-col gap-4 p-7">
          <span className="eyebrow">Your access</span>
          <p className="text-lg font-bold">{status}</p>
          <p className="text-ink-muted">
            Online payment is launching soon. For now, request an upgrade: we&apos;ll switch your access on and send payment details (Mobile Money or card) to <b>{user.email}</b>.
          </p>
          <UpgradeButton requested={!!upgradeRequestedAt} />
          {access.kind !== "ended" && access.kind !== "new" && (
            <Link href="/tools/stats" className="text-sm font-bold text-green">Back to your analyses →</Link>
          )}
          {access.kind === "new" && (
            <Link href="/tools/stats" className="btn-primary">Start your free trial first</Link>
          )}
        </div>
      </div>
    </section>
  );
}
