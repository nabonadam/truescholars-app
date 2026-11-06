import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { listSessions } from "@/server/stats";
import { ago } from "@/lib/time";
import { Icon } from "@/components/Icons";
import { SampleButton, UploadForm } from "@/components/stats/UploadForm";

export const metadata = { title: "Statistics Assistant" };

const CAN_DO = [
  { title: "Describe", text: "Summary statistics, frequencies and codebooks", cmds: ["summarize", "tabulate", "codebook"] },
  { title: "Cross-tabulate", text: "Row and column percentages with chi-square, Fisher's exact and Cramér's V", cmds: ["tab x y, row chi2"] },
  { title: "Compare groups", text: "t-tests, one-way and factorial ANOVA, with post-hoc comparisons", cmds: ["ttest", "oneway", "anova"] },
  { title: "Relate", text: "Pearson and Spearman correlations with significance", cmds: ["pwcorr, sig", "spearman"] },
  { title: "Model", text: "Linear, logistic, probit and Poisson regression with robust or clustered errors", cmds: ["regress", "logistic", "poisson"] },
  { title: "No assumptions", text: "Mann-Whitney, Kruskal-Wallis and Wilcoxon signed-rank tests", cmds: ["ranksum", "kwallis", "signrank"] },
];

export default async function StatsHome() {
  const user = await requireUser();
  const sessions = await listSessions(getDb(), user.id);

  return (
    <div>
      <section className="relative overflow-hidden bg-green-deep text-white">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 py-12 lg:grid-cols-[1.05fr_1fr] lg:py-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-bold text-amber">
              <Icon name="chart" size={14} /> Statistics Assistant
            </span>
            <h1 className="mt-4 text-[38px] leading-[1.05] font-extrabold sm:text-[50px]">
              Ask your data.
              <br />
              <span className="text-amber">Get Stata‑grade answers.</span>
            </h1>
            <p className="mt-4 max-w-lg text-[17px] text-on-green-muted">
              Type a question in plain English or write Stata yourself. You see the exact commands, the full output as Stata prints it, an APA table ready for your thesis, and a do-file that reproduces it all.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-[13px] text-on-green-muted">
              {["Stata syntax", "APA 7 tables", "Word & Excel export", "Do-file included"].map((t) => (
                <span key={t} className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1"><Icon name="check" size={13} className="text-amber" /> {t}</span>
              ))}
            </div>
          </div>
          <Preview />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 className="text-2xl font-extrabold">Start a session</h2>
            <div className="mt-1 mb-4 text-ink-muted">
              Your file stays private to you and is never changed. No data yet? <SampleButton />
            </div>
            <UploadForm />
            <p className="mt-3 flex items-start gap-2 text-[13px] text-ink-muted">
              <Icon name="lock" size={15} className="mt-0.5 flex-none" /> The assistant reads variable names, labels and summary numbers to plan your analysis. Individual rows never leave our engine.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-extrabold">Your sessions</h2>
            {sessions.length ? (
              <ul className="mt-4 space-y-2">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/tools/stats/${s.id}`} className="group flex items-center gap-3 rounded-sm border border-line bg-white p-3.5 no-underline transition hover:border-green">
                      <span className="grid h-10 w-10 flex-none place-items-center rounded-[12px] bg-green-tint font-mono text-[11px] font-bold text-green uppercase">{s.fileName.split(".").pop()}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold text-ink">{s.title}</span>
                        <span className="block text-xs text-ink-muted">{s.nObs.toLocaleString()} obs × {s.nVars} vars · {ago(s.updatedAt)}</span>
                      </span>
                      <span className="text-xl text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-green">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-sm border border-dashed border-line p-6 text-center text-sm text-ink-muted">Your analysis sessions will appear here.</p>
            )}
          </div>
        </div>

        <h2 className="mt-14 text-2xl font-extrabold">What it runs</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAN_DO.map((c) => (
            <div key={c.title} className="card p-5">
              <h3 className="text-lg font-bold">{c.title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{c.text}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.cmds.map((x) => <code key={x} className="rounded-[6px] bg-[#0c1f16] px-2 py-0.5 font-mono text-[12px] text-[#cfe3d6]"><span className="text-amber">. </span>{x}</code>)}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-ink-muted">
          Results are computed by our own engine to Stata&apos;s conventions (the same formats, base levels, robust and clustered errors). Stata is a registered trademark of StataCorp LLC; this tool is not affiliated with StataCorp.
        </p>
      </section>
    </div>
  );
}

/** A still life of the workspace: a question, its Stata output, and the APA table it becomes. */
function Preview() {
  const rows = [
    ["age", ".0738724", ".0381194", "1.94", "0.053"],
    ["urban", "6.616419", ".9759207", "6.78", "0.000"],
    ["_cons", "40.04162", "1.786148", "22.42", "0.000"],
  ];
  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <div className="mb-3 ml-auto w-fit max-w-[85%] rounded-[18px] rounded-br-[6px] bg-amber px-4 py-2.5 text-[14.5px] font-medium text-ink shadow-lg">
        Does living in a town predict higher well-being?
      </div>
      <div className="rounded-sm bg-[#0c1f16] p-4 shadow-2xl ring-1 ring-white/10">
        <div className="font-mono text-[12.5px]"><span className="text-amber">. </span><b>regress</b> wellbeing age i.urban</div>
        <pre className="mt-2 overflow-hidden font-mono text-[11.5px] leading-[1.5] text-[#8fbfa3]">
{`   wellbeing |  Coefficient  Std. err.      t    P>|t|
-------------+---------------------------------------
`}
          {rows.map((r) => (
            <span key={r[0]}>
              <span className="text-[#cfe3d6]">{r[0].padStart(12)}</span> | <span className="text-[#f7dcb3]">{r[1].padStart(10)}   {r[2].padStart(8)}  {r[3].padStart(6)}   {r[4]}</span>
              {"\n"}
            </span>
          ))}
        </pre>
      </div>
      <div className="apa relative z-10 -mt-5 ml-3 w-[66%] rotate-[-2deg] rounded-[4px] bg-white p-3 text-[11px] text-[#111] shadow-2xl sm:-ml-6">
        <div className="font-bold">Table 1</div>
        <div className="mb-1 italic">Linear regression predicting well-being</div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-y border-black py-0.5"><span>Predictor</span><span>B</span><span>p</span></div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3"><span>Age</span><span>0.07</span><span>.053</span></div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-black pb-0.5"><span>Urban</span><span>6.62</span><span>&lt; .001</span></div>
      </div>
    </div>
  );
}
