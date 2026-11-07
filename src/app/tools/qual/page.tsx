import Link from "next/link";
import { auth } from "@/auth";
import { Icon } from "@/components/Icons";
import { TemplatePicker } from "@/components/qual/HomeButtons";
import { getDb } from "@/db";
import { ago } from "@/lib/time";
import { listStudies } from "@/server/qual";
import { TEMPLATES } from "@/server/qualTemplates";
import { type Access, timeLeft, toolAccessFor, toolTrialDays } from "@/server/toolAccess";
import { UsageMeter } from "@/components/UsageMeter";

export const metadata = { title: "Qualitative Studio" };
export const dynamic = "force-dynamic";

const NEXT = "/tools/qual";

const STEPS = [
  { icon: "pen", title: "Build", text: "Voice and typed questions, multiple choice, ratings and sections, with a consent screen built in." },
  { icon: "message", title: "Share one link", text: "Send it on WhatsApp or email. People answer in their phone’s browser: no app, no account." },
  { icon: "mic", title: "Transcribe", text: "Every recording becomes text automatically. Read along, correct and tag each answer." },
  { icon: "layers", title: "Analyse", text: "Braun & Clarke thematic analysis: codes with real quotes, themes, a framework matrix and a report." },
] as const;

export default async function QualHome() {
  const user = (await auth())?.user;
  const db = getDb();
  const access = user ? await toolAccessFor(db, "qual", user) : null; // first visit starts the free trial
  const studies = user ? await listStudies(db, user.id) : [];
  const templates = Object.entries(TEMPLATES).map(([key, t]) => ({ key, title: t.title, blurb: t.blurb }));

  return (
    <div>
      <section className="relative overflow-hidden bg-green-deep text-white">
        <div className="pointer-events-none absolute -top-40 -right-32 size-[460px] rounded-full bg-amber/15" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 py-12 lg:grid-cols-[1.1fr_1fr] lg:py-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-bold text-amber">
              <Icon name="mic" size={14} /> Qualitative Studio
            </span>
            <h1 className="mt-4 text-[38px] leading-[1.05] font-extrabold sm:text-[50px]">
              Hear your participants.
              <br />
              <span className="text-amber">Find the themes.</span>
            </h1>
            <p className="mt-4 max-w-lg text-[17px] text-on-green-muted">
              Collect voice and text answers with one link, get every recording transcribed, and run a thematic analysis where every code points back to what someone actually said.
            </p>
            {!user && (
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href={`/sign-up?next=${NEXT}`} className="btn-amber min-h-12 px-6 text-base">Start your free {toolTrialDays()}-day trial</Link>
                <Link href={`/sign-in?next=${NEXT}`} className="font-bold text-white underline decoration-amber decoration-2 underline-offset-4">I have an account</Link>
                <span className="basis-full text-[13px] text-on-green-muted">No card needed. Your survey link keeps collecting answers even after the trial.</span>
              </div>
            )}
            {access && <AccessChip access={access} />}
            {access && access.kind !== "admin" && access.kind !== "ended" && <div className="mt-4 max-w-xs"><UsageMeter tool="qual" dark /></div>}
          </div>
          <Preview />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        {user && (
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
            {access?.kind === "ended" ? (
              <TrialEnded />
            ) : (
              <div>
                <h2 className="text-2xl font-extrabold">Start a study</h2>
                <p className="mt-1 mb-4 text-ink-muted">Pick a starting point; you can change every question.</p>
                <TemplatePicker templates={templates} />
              </div>
            )}
            <div>
              <h2 className="text-2xl font-extrabold">Your studies</h2>
              {studies.length ? (
                <ul className="mt-4 space-y-2">
                  {studies.map((s) => (
                    <li key={s.id}>
                      <Link href={`/tools/qual/${s.id}${s.responses ? "/responses" : ""}`} className="group flex items-center gap-3 rounded-sm border border-line bg-white p-3.5 no-underline transition hover:border-green">
                        <span className={`grid h-10 w-10 flex-none place-items-center rounded-[12px] ${s.status === "LIVE" ? "bg-amber-tint text-amber-deep" : "bg-green-tint text-green"}`}>
                          <Icon name="mic" size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold text-ink">{s.title}</span>
                          <span className="block text-xs text-ink-muted">
                            {s.status === "LIVE" ? "Live" : s.status === "CLOSED" ? "Closed" : "Draft"} · {s.responses} response{s.responses === 1 ? "" : "s"} · {ago(s.updatedAt)}
                          </span>
                        </span>
                        <span className="text-xl text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-green">›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 rounded-sm border border-dashed border-line p-6 text-center text-sm text-ink-muted">Your studies will appear here.</p>
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
          <Icon name="lock" size={17} className="mt-0.5 flex-none" />
          <p>
            Recordings are private to you. Only transcripts and typed answers go to the AI for analysis, never names, emails or audio, and every quote in your codes is checked against the transcripts. Exports work in NVivo, ATLAS.ti, MAXQDA, Excel, SPSS and R.
          </p>
        </div>
      </section>
    </div>
  );
}

function Preview() {
  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      <div className="rounded-lg bg-white p-5 text-ink shadow-2xl">
        <div className="text-[12px] font-bold tracking-wide text-ink-muted uppercase">Question 3 of 8</div>
        <p className="mt-1 text-[17px] font-bold">How has the change in rainfall affected your farming?</p>
        <div className="mt-4 flex items-center gap-4">
          <span className="relative grid size-16 place-items-center rounded-full bg-amber text-ink">
            <span className="absolute inset-0 rounded-full ring-4 ring-amber/30" />
            <Icon name="mic" size={26} />
          </span>
          <div>
            <div className="font-mono text-lg font-bold">1:42 <span className="text-sm font-normal text-ink-muted">/ 5:00</span></div>
            <div className="text-sm text-ink-muted">Recording…</div>
          </div>
        </div>
      </div>
      <div className="relative z-10 -mt-4 ml-6 rounded-lg bg-[#0c1f16] p-4 text-[13.5px] text-[#d6e3da] shadow-2xl ring-1 ring-white/10 sm:ml-12">
        <div className="mb-1.5 flex items-center gap-2 text-[11.5px] font-bold text-amber"><Icon name="spark" size={13} /> Transcript · coded</div>
        “The rains used to come in April. Now we plant and wait, and{" "}
        <mark className="rounded bg-amber/30 px-0.5 text-white">some years the seeds just die in the ground</mark>.”
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["Unreliable rainfall", "Lost harvests"].map((c) => (
            <span key={c} className="rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] text-white">{c}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccessChip({ access }: { access: Access }) {
  const [text, tone] =
    access.kind === "admin"
      ? ["Admin · unlimited access", "bg-white/10 text-white"]
      : access.kind === "trial"
        ? [`Free trial · ${timeLeft(access.endsAt)} left`, "bg-amber text-ink"]
        : access.kind === "granted"
          ? [`Access until ${access.endsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`, "bg-white/10 text-white"]
          : ["Free trial ended", "bg-white/10 text-amber"];
  return (
    <div className="mt-6">
      <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-bold ${tone}`}>
        <Icon name="clock" size={15} /> {text}
      </span>
    </div>
  );
}

function TrialEnded() {
  return (
    <div className="rounded-md border border-amber/40 bg-white p-6 sm:p-7">
      <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-amber-tint text-amber-deep"><Icon name="clock" size={22} /></span>
      <h2 className="mt-4 text-2xl font-extrabold">Your free trial has ended</h2>
      <p className="mt-2 text-ink-muted">
        Your studies are safe and your live links keep collecting answers. You can still read responses and download everything. Upgrade to build new studies, transcribe and analyse.
      </p>
      <Link href="/tools/qual/upgrade" className="btn-amber mt-5">Upgrade</Link>
    </div>
  );
}
