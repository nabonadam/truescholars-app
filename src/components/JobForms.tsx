"use client";

import { useActionState, useRef, useState } from "react";
import { hireAction, postJobAction, proposalAction, type JobFormState } from "@/app/actions/jobs";
import { formatMoney } from "@/lib/money";
import { SKILL_SUGGESTIONS, TITLE_EXAMPLES } from "@/lib/skills";

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.ppt,.pptx,.png,.jpg,.jpeg,.zip,.dta,.do,.sav,.r,.rmd,.nvp,.nvpx,.json,.md,.odt";

const TIMELINES = [
  { v: "3", label: "Within 3 days" },
  { v: "7", label: "Within a week" },
  { v: "14", label: "Within 2 weeks" },
  { v: "30", label: "Within a month" },
  { v: "", label: "Flexible" },
];
const LEVELS = [
  { v: "any", label: "Any level", hint: "Open to every verified expert" },
  { v: "masters", label: "Master's or above", hint: "Postgraduate training" },
  { v: "phd", label: "PhD holders", hint: "Doctoral-level expertise" },
];

const cedi = (minor: number) => formatMoney(minor).replace(/\.00$/, "");
const num = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function ErrorNote({ state }: { state: JobFormState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-sm bg-amber-tint px-4 py-3 text-sm font-medium text-amber-deep">
      {state.error}
    </p>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="grid size-8 flex-none place-items-center rounded-full bg-green font-display text-sm font-bold text-amber">{n}</span>
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          {hint && <p className="text-sm text-ink-muted">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

// ───────────── Post a job ─────────────

type Cat = { id: string; slug: string; name: string };
type Guide = { low: number; median: number; high: number; n: number };

const CHECKS: { label: string; test: (d: string) => boolean }[] = [
  { label: "Says what you want delivered (a report, tables, edited chapter…)", test: (d) => /deliver|report|chapter|tables?|write-?up|results|summary|document|slides|edited|output|code|map|transcripts?/i.test(d) },
  { label: "Mentions your data, software or method", test: (d) => /stata|spss|\br\b|python|nvivo|atlas|excel|data|survey|interview|regression|qualitative|quantitative|dataset|questionnaire|literature|apa|harvard/i.test(d) },
  { label: "Gives the size of the work (pages, words, respondents…)", test: (d) => /\d/.test(d) },
  { label: "Has enough detail to quote accurately", test: (d) => d.trim().length >= 250 },
];

export function PostJobForm({ categories, guides }: { categories: Cat[]; guides: Record<string, Guide> }) {
  const [state, action, pending] = useActionState<JobFormState, FormData>(postJobAction, undefined);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [timeline, setTimeline] = useState("7");
  const [level, setLevel] = useState("any");

  const cat = categories.find((c) => c.id === categoryId);
  const guide = categoryId ? guides[categoryId] : undefined;
  const passed = CHECKS.filter((c) => c.test(description)).length;
  const quality = description.trim().length < 80 ? 0 : passed;
  const qualityLabel = ["Keep going", "Needs more detail", "Getting there", "Good brief", "Excellent brief"][quality];
  const suggestions = (cat ? SKILL_SUGGESTIONS[cat.slug] ?? [] : []).filter((s) => !skills.some((k) => k.toLowerCase() === s.toLowerCase()));

  const addSkill = (raw: string) => {
    const s = raw.trim().replace(/,$/, "").trim();
    if (!s || skills.length >= 8 || skills.some((k) => k.toLowerCase() === s.toLowerCase())) return;
    setSkills([...skills, s.slice(0, 30)]);
    setDraft("");
  };

  const minN = num(min);
  const maxN = num(max);
  const budgetText = minN && maxN ? (minN === maxN ? cedi(minN * 100) : `${cedi(minN * 100)}–${cedi(maxN * 100).replace("GH₵", "")}`) : "Your budget";

  return (
    <form action={action} className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Step n={1} title="What do you need done?" hint="A clear, specific title gets better proposals.">
          <div>
            <label htmlFor="title" className="label">Job title</label>
            <input id="title" name="title" required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} className="field" placeholder="e.g. Run a regression analysis in Stata on my survey data" />
            {!title && (
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="text-xs text-ink-muted">Examples:</span>
                {TITLE_EXAMPLES.map((t) => (
                  <button key={t} type="button" onClick={() => setTitle(t)} className="rounded-full border border-line bg-parchment px-3 py-1 text-left text-xs text-ink hover:border-green">
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          <fieldset>
            <legend className="label">Category</legend>
            <input type="hidden" name="categoryId" value={categoryId} />
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={categoryId === c.id}
                  onClick={() => setCategoryId(c.id)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-medium ${categoryId === c.id ? "border-green bg-green text-white" : "border-line bg-white text-ink hover:border-green"}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </fieldset>
        </Step>

        <Step n={2} title="Describe the work" hint="Experts quote from this, so the more they know, the more accurate the price.">
          <div>
            <label htmlFor="description" className="label">Description</label>
            <textarea
              id="description"
              name="description"
              required
              rows={9}
              maxLength={6000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="field"
              placeholder={"What's your research about?\nWhat data, software or method is involved?\nWhat exactly should the expert deliver, and by when?"}
            />
            <div className="mt-1 text-right text-xs text-ink-muted">{description.length.toLocaleString()} / 6,000</div>
          </div>
          <div className="rounded-sm bg-parchment p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-bold">Brief quality</span>
              <span className={`text-sm font-bold ${quality >= 3 ? "text-green" : "text-amber-deep"}`}>{qualityLabel}</span>
            </div>
            <div className="mb-3 grid grid-cols-4 gap-1" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={`h-1.5 rounded-full transition-colors ${quality >= i ? (quality >= 3 ? "bg-green" : "bg-amber") : "bg-line"}`} />
              ))}
            </div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {CHECKS.map((c) => {
                const ok = description.trim().length >= 20 && c.test(description);
                return (
                  <li key={c.label} className={`flex items-start gap-2 ${ok ? "text-ink" : "text-ink-muted"}`}>
                    <span className={`mt-0.5 grid size-4 flex-none place-items-center rounded-full text-[10px] font-bold ${ok ? "bg-green text-white" : "border border-ink-muted/40"}`}>{ok ? "✓" : ""}</span>
                    {c.label}
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <label htmlFor="files" className="label">Attachments <span className="font-normal text-ink-muted">(optional: brief, data sample, guidelines · up to 5 files, 10 MB each)</span></label>
            <input id="files" name="files" type="file" multiple accept={ACCEPT} className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-green-tint file:px-4 file:py-2 file:font-bold file:text-green" />
          </div>
        </Step>

        <Step n={3} title="Skills needed" hint="Up to 8. Experts with these skills see your job first.">
          <input type="hidden" name="skills" value={skills.join(",")} />
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-white p-2 focus-within:border-green">
            {skills.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-green px-3 py-1 text-sm font-medium text-white">
                {s}
                <button type="button" onClick={() => setSkills(skills.filter((k) => k !== s))} aria-label={`Remove ${s}`} className="grid size-5 place-items-center rounded-full hover:bg-white/20">×</button>
              </span>
            ))}
            <label htmlFor="skill" className="sr-only">Add a skill</label>
            <input
              id="skill"
              value={draft}
              onChange={(e) => (e.target.value.endsWith(",") ? addSkill(e.target.value) : setDraft(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill(draft);
                } else if (e.key === "Backspace" && !draft && skills.length) setSkills(skills.slice(0, -1));
              }}
              onBlur={() => draft && addSkill(draft)}
              placeholder={skills.length >= 8 ? "That's the maximum" : "Type a skill and press Enter"}
              disabled={skills.length >= 8}
              className="min-w-40 flex-1 px-2 py-1.5 outline-none"
            />
          </div>
          {suggestions.length > 0 && skills.length < 8 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-ink-muted">Popular in {cat?.name}:</span>
              {suggestions.slice(0, 7).map((s) => (
                <button key={s} type="button" onClick={() => addSkill(s)} className="rounded-full border border-dashed border-green/50 px-3 py-1 text-xs font-medium text-green hover:bg-green-tint">
                  + {s}
                </button>
              ))}
            </div>
          )}
        </Step>

        <Step n={4} title="Budget and timeline" hint="Fixed price, paid into escrow. You release money only when you approve the work.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="budgetMin" className="label">From (GH₵)</label>
              <input id="budgetMin" name="budgetMin" inputMode="decimal" required value={min} onChange={(e) => setMin(e.target.value)} className="field" placeholder="300" />
            </div>
            <div>
              <label htmlFor="budgetMax" className="label">To (GH₵)</label>
              <input id="budgetMax" name="budgetMax" inputMode="decimal" required value={max} onChange={(e) => setMax(e.target.value)} className="field" placeholder="600" />
            </div>
          </div>
          {guide ? (
            <div className="flex flex-wrap items-center gap-3 rounded-sm bg-green-tint px-4 py-3 text-sm">
              <span className="text-green">
                Experts in <b>{cat?.name}</b> usually charge <b>{cedi(guide.low)}–{cedi(guide.high).replace("GH₵", "")}</b> (typical {cedi(guide.median)}).
              </span>
              <button type="button" onClick={() => { setMin(String(guide.low / 100)); setMax(String(guide.high / 100)); }} className="ml-auto rounded-full bg-green px-3 py-1.5 text-xs font-bold text-white">
                Use this range
              </button>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Tip: a range gets more proposals than a single figure. Experts can still quote below your top number.</p>
          )}
          {minN > 0 && maxN > 0 && maxN < minN && <p className="text-sm font-medium text-amber-deep">The “to” amount should be at least the “from” amount.</p>}

          <fieldset>
            <legend className="label">When do you need it?</legend>
            <input type="hidden" name="timeline" value={timeline} />
            <div className="flex flex-wrap gap-2">
              {TIMELINES.map((t) => (
                <button key={t.v} type="button" aria-pressed={timeline === t.v} onClick={() => setTimeline(t.v)} className={`rounded-full border px-4 py-2 text-sm font-medium ${timeline === t.v ? "border-green bg-green text-white" : "border-line bg-white hover:border-green"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">Expertise level</legend>
            <input type="hidden" name="level" value={level} />
            <div className="grid gap-2 sm:grid-cols-3">
              {LEVELS.map((l) => (
                <button key={l.v} type="button" aria-pressed={level === l.v} onClick={() => setLevel(l.v)} className={`flex flex-col items-start rounded-sm border-2 p-3 text-left ${level === l.v ? "border-green bg-green-tint" : "border-line bg-white hover:border-green/40"}`}>
                  <span className="font-bold">{l.label}</span>
                  <span className="text-xs text-ink-muted">{l.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </Step>

        <ErrorNote state={state} />
        <div className="flex flex-wrap items-center gap-4">
          <button className="btn-primary min-h-12 px-8 text-base" disabled={pending}>{pending ? "Posting…" : "Post job"}</button>
          <span className="text-sm text-ink-muted">Free to post. You only pay when you hire.</span>
        </div>
      </div>

      {/* Live preview */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-6" aria-label="Preview">
        <span className="eyebrow">How experts will see it</span>
        <div className="flex flex-col gap-3 rounded-md border border-line bg-white p-5 shadow-sm">
          <div className="text-xs text-ink-muted">
            <span className="font-bold tracking-wide text-green uppercase">{cat?.name ?? "Category"}</span> · Posted just now
          </div>
          <h3 className={`font-display text-lg leading-snug font-bold ${title ? "" : "text-ink-muted/60"}`}>{title || "Your job title"}</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span><span className="text-ink-muted">Budget</span> <b>{budgetText}</b></span>
            <span className="text-ink-muted">{TIMELINES.find((t) => t.v === timeline)?.label}</span>
          </div>
          <p className={`line-clamp-4 text-sm ${description ? "text-ink-muted" : "text-ink-muted/60"}`}>{description || "Your description appears here."}</p>
          {skills.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {skills.map((s) => <li key={s} className="rounded-full bg-parchment px-3 py-1 text-xs">{s}</li>)}
            </ul>
          )}
          <div className="border-t border-line pt-3 text-xs font-bold text-green">Be the first to bid</div>
        </div>
        <div className="rounded-md bg-green p-5 text-sm text-white">
          <div className="mb-2 font-display text-base font-bold">What happens next</div>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-on-green-muted">
            <li>Matching experts get an alert straight away.</li>
            <li>Proposals arrive with a price and a milestone plan.</li>
            <li>Shortlist, compare side by side, then hire.</li>
            <li>Pay each milestone into escrow; release it when you approve.</li>
          </ol>
        </div>
      </aside>
    </form>
  );
}

// ───────────── Send a proposal ─────────────

type Row = { title: string; amount: string; days: string };

export function ProposalForm({
  jobId,
  budgetMinMinor,
  budgetMaxMinor,
  feeBps,
  cost,
  balance,
  suggestedDays,
}: {
  jobId: string;
  budgetMinMinor: number;
  budgetMaxMinor: number;
  feeBps: number;
  cost: number;
  balance: number;
  suggestedDays: number | null;
}) {
  const [state, action, pending] = useActionState<JobFormState, FormData>(proposalAction, undefined);
  const [mode, setMode] = useState<"single" | "milestones">("single");
  const [pitch, setPitch] = useState("");
  const [single, setSingle] = useState<Row>({ title: "Complete the project", amount: "", days: suggestedDays ? String(suggestedDays) : "" });
  const [rows, setRows] = useState<Row[]>([
    { title: "", amount: "", days: "" },
    { title: "", amount: "", days: "" },
  ]);

  const plan = mode === "single" ? [single] : rows;
  const totalMinor = Math.round(plan.reduce((s, r) => s + num(r.amount), 0) * 100);
  const totalDays = plan.reduce((s, r) => s + Math.round(num(r.days)), 0);
  const feeMinor = Math.round((totalMinor * feeBps) / 10_000);
  const enough = balance >= cost;
  const budgetNote =
    totalMinor === 0 ? null : totalMinor > budgetMaxMinor ? { ok: false, text: `${cedi(totalMinor - budgetMaxMinor)} above the client's budget` } : totalMinor < budgetMinMinor ? { ok: true, text: "Below the client's range: a strong offer" } : { ok: true, text: "Within the client's budget" };
  const json = JSON.stringify(plan);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="plan" value={json} />
      <div>
        <label htmlFor="pitch" className="label">Cover letter</label>
        <textarea
          id="pitch"
          name="pitch"
          rows={7}
          required
          maxLength={5000}
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          className="field"
          placeholder={"Open with how you'd approach this job, not a summary of your CV.\n• Similar work you've done\n• Your plan and what you'll deliver\n• Any questions about the data or scope"}
        />
        <div className="mt-1 flex justify-between text-xs text-ink-muted">
          <span>{pitch.trim().length < 50 ? `At least ${50 - pitch.trim().length} more characters` : "Tip: mention one similar project you've done."}</span>
          <span>{pitch.length.toLocaleString()} / 5,000</span>
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="label">How do you want to be paid?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["single", "milestones"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-sm border-2 p-3 text-left ${mode === m ? "border-green bg-green-tint" : "border-line bg-white"}`}>
              <span className="block font-bold">{m === "single" ? "One payment" : "By milestone"}</span>
              <span className="text-xs text-ink-muted">{m === "single" ? "For smaller, quick jobs" : "Split bigger work into stages"}</span>
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="amount" className="label">Your price (GH₵)</label>
              <input id="amount" inputMode="decimal" value={single.amount} onChange={(e) => setSingle({ ...single, amount: e.target.value })} className="field" placeholder={String(Math.round(budgetMaxMinor / 100))} />
            </div>
            <div>
              <label htmlFor="days" className="label">Delivery (days)</label>
              <input id="days" inputMode="numeric" value={single.days} onChange={(e) => setSingle({ ...single, days: e.target.value })} className="field" placeholder="7" />
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {rows.map((r, i) => (
              <li key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-sm border border-line bg-parchment/60 p-3">
                <div className="col-span-2 flex items-center gap-2">
                  <span className="grid size-6 flex-none place-items-center rounded-full bg-green text-xs font-bold text-white">{i + 1}</span>
                  <label htmlFor={`m-title-${i}`} className="sr-only">Milestone {i + 1} name</label>
                  <input id={`m-title-${i}`} value={r.title} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className="field !py-2" placeholder={i === 0 ? "e.g. Data cleaning and descriptives" : "e.g. Models and write-up"} />
                  {rows.length > 1 && (
                    <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove milestone ${i + 1}`} className="grid size-9 flex-none place-items-center rounded-full text-ink-muted hover:bg-white">×</button>
                  )}
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor={`m-amt-${i}`} className="text-xs font-bold text-ink-muted">Amount (GH₵)</label>
                    <input id={`m-amt-${i}`} inputMode="decimal" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className="field !py-2" />
                  </div>
                  <div>
                    <label htmlFor={`m-days-${i}`} className="text-xs font-bold text-ink-muted">Days after it's funded</label>
                    <input id={`m-days-${i}`} inputMode="numeric" value={r.days} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, days: e.target.value } : x)))} className="field !py-2" />
                  </div>
                </div>
              </li>
            ))}
            {rows.length < 5 && (
              <button type="button" onClick={() => setRows([...rows, { title: "", amount: "", days: "" }])} className="self-start rounded-full border border-dashed border-green px-4 py-2 text-sm font-bold text-green">
                + Add milestone
              </button>
            )}
          </ol>
        )}
      </fieldset>

      <div className="flex flex-col gap-2 rounded-sm bg-green p-4 text-sm text-white">
        <div className="flex justify-between"><span className="text-on-green-muted">Total the client pays</span><b>{formatMoney(totalMinor)}</b></div>
        <div className="flex justify-between"><span className="text-on-green-muted">Platform fee ({feeBps / 100}%)</span><span>−{formatMoney(feeMinor)}</span></div>
        <div className="flex justify-between border-t border-white/20 pt-2 text-base"><span>You&apos;ll receive</span><b className="font-display text-amber">{formatMoney(totalMinor - feeMinor)}</b></div>
        <div className="flex justify-between text-on-green-muted">
          <span>Total time</span>
          <span>{totalDays > 0 ? `${totalDays} day${totalDays === 1 ? "" : "s"}` : "–"}</span>
        </div>
        {budgetNote && <div className={`rounded-full px-3 py-1 text-center text-xs font-bold ${budgetNote.ok ? "bg-white/15 text-white" : "bg-amber text-ink"}`}>{budgetNote.text}</div>}
      </div>

      <ErrorNote state={state} />
      <div className="flex flex-col gap-2">
        <button className="btn-primary min-h-12 w-full text-base" disabled={pending || !enough}>
          {pending ? "Sending…" : `Send proposal · ${cost} credits`}
        </button>
        <p className={`text-center text-xs ${enough ? "text-ink-muted" : "font-bold text-amber-deep"}`}>
          {enough ? `You have ${balance} credits. ${balance - cost} left after this.` : `You need ${cost} credits and have ${balance}. Your free credits top up on the 1st.`}
        </p>
      </div>
    </form>
  );
}

// ───────────── Hire ─────────────

export function HireButton({
  proposalId,
  expertName,
  totalLabel,
  milestones,
  compact = false,
}: {
  proposalId: string;
  expertName: string;
  totalLabel: string;
  milestones: { title: string; amountLabel: string; days: number }[];
  compact?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<JobFormState, FormData>(hireAction, undefined);
  const first = expertName.split(" ")[0];
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={`btn-primary ${compact ? "min-h-10 px-4 text-sm" : ""}`}>
        Hire {first}
      </button>
      <dialog ref={ref} className="m-auto w-[min(92vw,30rem)] rounded-md border border-line p-0 text-ink shadow-2xl backdrop:bg-ink/50">
        <form action={action} className="flex flex-col gap-4 p-6">
          <input type="hidden" name="proposalId" value={proposalId} />
          <div>
            <span className="eyebrow">Confirm hire</span>
            <h2 className="text-2xl font-bold">Hire {expertName}?</h2>
          </div>
          <ol className="flex flex-col divide-y divide-line rounded-sm border border-line">
            {milestones.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-bold">{i + 1}. {m.title}</span>
                  <span className="block text-xs text-ink-muted">{m.days} day{m.days === 1 ? "" : "s"} once funded</span>
                </span>
                <b className="flex-none">{m.amountLabel}</b>
              </li>
            ))}
          </ol>
          <div className="flex justify-between text-base"><span>Total</span><b className="font-display">{totalLabel}</b></div>
          <p className="rounded-sm bg-green-tint px-4 py-3 text-sm text-green">
            Next, you&apos;ll pay milestone 1 ({milestones[0]?.amountLabel}) into escrow. {first} is paid only when you approve each delivery. Other applicants will be told you&apos;ve hired.
          </p>
          <ErrorNote state={state} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} className="btn-outline">Not yet</button>
            <button className="btn-primary" disabled={pending}>{pending ? "Hiring…" : `Hire and continue`}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
