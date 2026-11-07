import Link from "next/link";
import { auth } from "@/auth";
import { Icon } from "@/components/Icons";
import { NewReview } from "@/components/lit/NewReview";
import { getDb } from "@/db";
import { ago } from "@/lib/time";
import { listReviews } from "@/server/lit";
import { type Access, timeLeft, toolAccessFor, toolTrialDays } from "@/server/toolAccess";

export const metadata = { title: "Literature Review" };
export const dynamic = "force-dynamic";

const NEXT = "/tools/lit";
const STEPS = [
  { icon: "upload", title: "Bring the papers", text: "Upload the PDFs you have, or have a vetted expert find the right literature for your question. Every paper is checked against Crossref." },
  { icon: "book", title: "Systematic reading", text: "Each paper is read in full: introduction, methods, findings, conclusions, key terms and keywords, every point tied to a quote and page you can check." },
  { icon: "layers", title: "Synthesis", text: "Themes across papers, where they agree, where they contradict and why, the gaps, and how authors define key terms." },
  { icon: "pen", title: "Critical writing", text: "An outline you approve, then concise, idea-led paragraphs. Every sentence shows its sources; anything unsupported is flagged." },
] as const;
const STATUS: Record<string, string> = { DRAFT: "Your papers", RETRIEVAL: "Expert finding literature", REVIEWING: "Literature to review", ANALYSIS: "Analysis" };

export default async function LitHome() {
  const user = (await auth())?.user;
  const db = getDb();
  const access = user ? await toolAccessFor(db, "lit", user) : null;
  const reviews = user ? await listReviews(db, user.id) : [];
  return (
    <div>
      <section className="relative overflow-hidden bg-green-deep text-white">
        <div className="pointer-events-none absolute -top-40 -right-32 size-[460px] rounded-full bg-amber/15" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 py-12 lg:grid-cols-[1.1fr_1fr] lg:py-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-bold text-amber"><Icon name="book" size={14} /> Literature Review</span>
            <h1 className="mt-4 text-[38px] leading-[1.05] font-extrabold sm:text-[50px]">
              Real papers. Read properly.
              <br />
              <span className="text-amber">Synthesised critically.</span>
            </h1>
            <p className="mt-4 max-w-lg text-[17px] text-on-green-muted">
              No invented references and no fifty pages of summaries. Your review is built from papers you or a vetted expert chose, and every sentence points back to the passage it rests on.
            </p>
            {!user && (
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href={`/sign-up?next=${NEXT}`} className="btn-amber min-h-12 px-6 text-base">Start your free {toolTrialDays()}-day trial</Link>
                <Link href={`/sign-in?next=${NEXT}`} className="font-bold text-white underline decoration-amber decoration-2 underline-offset-4">I have an account</Link>
                <span className="basis-full text-[13px] text-on-green-muted">No card needed.</span>
              </div>
            )}
            {access && <AccessChip access={access} />}
          </div>
          <Preview />
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-5 py-10">
        {user && (
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
            {access?.kind === "ended" ? (
              <div className="rounded-md border border-amber/40 bg-white p-6">
                <h2 className="text-2xl font-extrabold">Your free trial has ended</h2>
                <p className="mt-2 text-ink-muted">Your reviews and downloads are safe. Upgrade to start new reviews and run the AI steps.</p>
                <Link href="/tools/lit/upgrade" className="btn-amber mt-5">Upgrade</Link>
              </div>
            ) : (
              <div>
                <h2 className="text-2xl font-extrabold">Start a review</h2>
                <p className="mt-1 mb-4 text-ink-muted">Everything is organised around your research question.</p>
                <NewReview />
              </div>
            )}
            <div>
              <h2 className="text-2xl font-extrabold">Your reviews</h2>
              {reviews.length ? (
                <ul className="mt-4 space-y-2">
                  {reviews.map((r) => (
                    <li key={r.id}>
                      <Link href={`/tools/lit/${r.id}`} className="group flex items-center gap-3 rounded-sm border border-line bg-white p-3.5 no-underline transition hover:border-green">
                        <span className="grid h-10 w-10 flex-none place-items-center rounded-[12px] bg-green-tint text-green"><Icon name="book" size={18} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold text-ink">{r.title}</span>
                          <span className="block text-xs text-ink-muted">{STATUS[r.status] ?? r.status} · {r.papers} paper{r.papers === 1 ? "" : "s"} · {ago(r.updatedAt)}</span>
                        </span>
                        <span className="text-xl text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-green">›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 rounded-sm border border-dashed border-line p-6 text-center text-sm text-ink-muted">Your reviews will appear here.</p>
              )}
            </div>
          </div>
        )}
        <h2 className={`${user ? "mt-14" : ""} text-2xl font-extrabold`}>How it works</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="card p-5">
              <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-green text-amber"><Icon name={s.icon} size={18} /></span>
              <h3 className="mt-3 text-lg font-bold">{i + 1}. {s.title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{s.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-start gap-2.5 rounded-sm bg-green-tint p-4 text-[14px] text-green">
          <Icon name="shield" size={17} className="mt-0.5 flex-none" />
          <p>The AI never searches the web or adds sources of its own. It works only with the papers you accept, and every quote is checked word for word against the PDF. You remain the author: the tool coaches critical writing; it doesn&apos;t replace it.</p>
        </div>
      </section>
    </div>
  );
}

function Preview() {
  return (
    <div className="relative mx-auto w-full max-w-[470px]">
      <div className="rounded-lg bg-white p-5 text-ink shadow-2xl">
        <div className="text-[12px] font-bold tracking-wide text-ink-muted uppercase">Theme · 7 of 9 papers</div>
        <p className="mt-1 text-[17px] font-extrabold">Capacity to adapt is unevenly distributed</p>
        <p className="mt-2 text-[14.5px] leading-relaxed">
          Access to credit, land and labour shapes which households adapt <span className="text-green">(Mensah &amp; Owusu, 2021; Boateng et al., 2019)</span>, yet the evidence comes almost entirely from inland savannah settings.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11.5px] font-bold">
          <span className="rounded-full bg-green-tint px-2 py-0.5 text-green">✓ 2 passages checked</span>
          <span className="rounded-full bg-amber-tint px-2 py-0.5 text-amber-deep">Gap: coastal studies</span>
        </div>
      </div>
      <div className="relative z-10 -mt-3 ml-8 rounded-lg bg-[#0c1f16] p-4 text-[13px] text-[#d6e3da] shadow-2xl ring-1 ring-white/10 sm:ml-14">
        <div className="mb-1 flex items-center gap-2 text-[11.5px] font-bold text-amber"><Icon name="quote" size={13} /> P03 · page 7</div>
        “Adaptation was shaped by access to credit, land and labour; women farmers faced the greatest constraints.”
      </div>
    </div>
  );
}

function AccessChip({ access }: { access: Access }) {
  const [text, tone] =
    access.kind === "admin" ? ["Admin · unlimited access", "bg-white/10 text-white"] :
    access.kind === "trial" ? [`Free trial · ${timeLeft(access.endsAt)} left`, "bg-amber text-ink"] :
    access.kind === "granted" ? [`Access until ${access.endsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`, "bg-white/10 text-white"] :
    ["Free trial ended", "bg-white/10 text-amber"];
  return (
    <div className="mt-6">
      <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-bold ${tone}`}><Icon name="clock" size={15} /> {text}</span>
    </div>
  );
}
