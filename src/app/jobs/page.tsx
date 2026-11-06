import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { Icon } from "@/components/Icons";
import { JobCard } from "@/components/JobCard";
import { getDb } from "@/db";
import { creditBalance, expertProfileOf, listOpenJobs, nextRefill, recommendedJobs, type BudgetFilter, type JobSort } from "@/server/jobs";
import { listCategories } from "@/server/services";

export const metadata: Metadata = { title: "Find work" };
export const dynamic = "force-dynamic";

const BUDGETS: { v: BudgetFilter; label: string }[] = [
  { v: "", label: "Any budget" },
  { v: "u500", label: "Up to GH₵500" },
  { v: "500-2000", label: "GH₵500 – 2,000" },
  { v: "2000+", label: "GH₵2,000+" },
];
const SORTS: { v: JobSort; label: string }[] = [
  { v: "newest", label: "Newest" },
  { v: "fewest", label: "Fewest proposals" },
  { v: "budget", label: "Highest budget" },
];

export default async function JobBoard({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; budget?: string; sort?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const category = sp.category ?? "";
  const budget = (BUDGETS.some((b) => b.v === sp.budget) ? sp.budget : "") as BudgetFilter;
  const sort = (SORTS.some((s) => s.v === sp.sort) ? sp.sort : "newest") as JobSort;
  const session = await auth().catch(() => null);
  const user = session?.user;
  const isExpert = Boolean(user?.roles.includes("EXPERT"));
  const db = getDb();

  const profile = isExpert && user ? await expertProfileOf(db, user.id) : null;
  const filtering = Boolean(q || category || budget);
  const [cats, jobs, recs, credits] = await Promise.all([
    listCategories(db),
    listOpenJobs(db, { q, category, budget, sort, viewerUserId: user?.id }),
    profile && user && !filtering ? recommendedJobs(db, user.id, 4) : Promise.resolve([]),
    profile ? creditBalance(db, profile.id) : Promise.resolve(null),
  ]);
  const recIds = new Set(recs.map((r) => r.id));
  const rest = jobs.filter((j) => !recIds.has(j.id) && (!user || j.clientId !== user.id));
  const link = (o: Partial<{ q: string; category: string; budget: string; sort: string }>) => {
    const p = new URLSearchParams();
    const m = { q, category, budget, sort, ...o };
    for (const [k, v] of Object.entries(m)) if (v && !(k === "sort" && v === "newest")) p.set(k, v);
    const s = p.toString();
    return s ? `/jobs?${s}` : "/jobs";
  };
  const activeCat = cats.find((c) => c.slug === category);
  const filters = (
    <>
      <FilterGroup title="Category">
        <FilterLink href={link({ category: "" })} on={!category}>All categories</FilterLink>
        {cats.map((c) => (
          <FilterLink key={c.id} href={link({ category: c.slug })} on={category === c.slug}>{c.name}</FilterLink>
        ))}
      </FilterGroup>
      <FilterGroup title="Budget">
        {BUDGETS.map((b) => (
          <FilterLink key={b.v} href={link({ budget: b.v })} on={budget === b.v}>{b.label}</FilterLink>
        ))}
      </FilterGroup>
    </>
  );

  return (
    <>
      <section className="relative overflow-hidden bg-green text-white">
        <div className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-amber/10" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-white/5" aria-hidden="true" />
        <div className="relative mx-auto flex max-w-7xl flex-col gap-5 px-4 py-10 sm:px-6 sm:py-14">
          <span className="eyebrow !text-amber">Find work</span>
          <h1 className="max-w-3xl text-3xl font-extrabold sm:text-5xl">Research jobs from scholars who need your expertise</h1>
          <form action="/jobs" className="flex max-w-2xl flex-wrap gap-2 rounded-[18px] bg-white p-2" role="search">
            {category && <input type="hidden" name="category" value={category} />}
            {budget && <input type="hidden" name="budget" value={budget} />}
            <label htmlFor="q" className="sr-only">Search jobs</label>
            <input id="q" name="q" defaultValue={q} placeholder="Search jobs: Stata, NVivo, editing…" className="min-w-0 flex-[1_1_220px] px-3 py-3 text-ink outline-none" />
            <button className="btn-primary flex-[1_1_auto] sm:flex-none">Search</button>
          </form>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {credits !== null ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2">
                <b className="text-amber">{credits} bid credits</b>
                <span className="text-on-green-muted">· free top-up on {nextRefill(new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
              </span>
            ) : user ? (
              <Link href="/apply" className="font-bold text-amber">Become a verified expert to send proposals →</Link>
            ) : (
              <Link href="/sign-up" className="font-bold text-amber">Join free to send proposals →</Link>
            )}
            <span className="text-on-green-muted">Need help instead?</span>
            <Link href="/jobs/new" className="font-bold text-white">Post a job</Link>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[250px_1fr]">
        <aside className="flex flex-col gap-6" aria-label="Filters">
          <details className="lg:hidden">
            <summary className="flex cursor-pointer items-center justify-between rounded-sm border border-line bg-white px-4 py-3 font-bold">
              Filters {filtering && <span className="rounded-full bg-amber px-2 text-xs text-ink">On</span>}
            </summary>
            <div className="mt-4 flex flex-col gap-6">{filters}</div>
          </details>
          <div className="hidden flex-col gap-6 lg:flex">{filters}</div>
        </aside>

        <div className="flex min-w-0 flex-col gap-8">
          {recs.length > 0 && (
            <section className="flex flex-col gap-4 rounded-lg bg-amber-tint/60 p-4 sm:p-6" aria-labelledby="rec">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-amber text-ink"><Icon name="spark" size={20} /></span>
                <div>
                  <h2 id="rec" className="text-xl font-bold">Recommended for you</h2>
                  <p className="text-sm text-ink-muted">Matched to the services and skills on your profile.</p>
                </div>
              </div>
              <ul className="grid gap-4 xl:grid-cols-2">
                {recs.map((j) => (
                  <li key={j.id}><JobCard job={j} highlight /></li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-col gap-4" aria-labelledby="all">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="all" className="text-xl font-bold">{recs.length ? "More open jobs" : "Open jobs"}</h2>
                <p className="text-sm text-ink-muted">
                  {rest.length} job{rest.length === 1 ? "" : "s"}{activeCat ? ` in ${activeCat.name}` : ""}{q ? ` matching “${q}”` : ""}
                  {filtering && <> · <Link href="/jobs" className="font-bold text-green">Clear filters</Link></>}
                </p>
              </div>
              <nav className="flex gap-1 rounded-full border border-line bg-white p-1 text-sm" aria-label="Sort">
                {SORTS.map((s) => (
                  <Link key={s.v} href={link({ sort: s.v })} aria-current={sort === s.v ? "true" : undefined} className={`rounded-full px-3 py-1.5 font-bold no-underline ${sort === s.v ? "bg-green text-white" : "text-ink"}`}>
                    {s.label}
                  </Link>
                ))}
              </nav>
            </div>
            {rest.length === 0 ? (
              <div className="card flex flex-col items-start gap-3">
                <Icon name="briefcase" size={28} className="text-green" />
                <h3 className="text-xl font-bold">{filtering ? "No jobs match those filters" : "No open jobs right now"}</h3>
                <p className="text-ink-muted">{filtering ? "Try a broader search or another category." : "New jobs arrive all the time. Experts are notified when one matches their category."}</p>
              </div>
            ) : (
              <ul className="grid gap-4 xl:grid-cols-2">
                {rest.map((j) => (
                  <li key={j.id}><JobCard job={j} /></li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="mb-1 font-sans text-xs font-bold tracking-wider text-ink-muted uppercase">{title}</h3>
      {children}
    </div>
  );
}

function FilterLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={on ? "true" : undefined} className={`rounded-sm px-3 py-2 text-sm no-underline ${on ? "bg-green-tint font-bold text-green" : "text-ink hover:bg-white"}`}>
      {children}
    </Link>
  );
}
