import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/Icons";
import { Avatar, LEVEL_LABEL, Stars } from "@/components/People";
import { getDb } from "@/db";
import { coverFor, iconFor, POPULAR_SEARCHES } from "@/lib/categoryIcons";
import { formatMoney } from "@/lib/money";
import { browseServices, categoryCounts, groupByExpert, type BrowseExpert, type BrowseService, type Budget, type Delivery, type LevelFilter, type Sort } from "@/server/browse";

export const metadata: Metadata = { title: "Find an expert" };
export const dynamic = "force-dynamic";

const SORTS: { v: Sort; label: string }[] = [
  { v: "recommended", label: "Recommended" },
  { v: "rating", label: "Top rated" },
  { v: "price", label: "Lowest price" },
  { v: "fast", label: "Fastest" },
];
const BUDGETS: { v: Budget; label: string }[] = [
  { v: "", label: "Any price" },
  { v: "u200", label: "Under GH₵200" },
  { v: "200-500", label: "GH₵200–500" },
  { v: "500+", label: "GH₵500+" },
];
const DELIVERY: { v: Delivery; label: string }[] = [
  { v: "", label: "Any time" },
  { v: "3", label: "Up to 3 days" },
  { v: "7", label: "Up to a week" },
];
const LEVELS: { v: LevelFilter; label: string }[] = [
  { v: "", label: "Any level" },
  { v: "l1", label: "Level 1 and up" },
  { v: "top", label: "Top rated" },
];

const pick = <T extends string>(v: string | undefined, list: { v: T }[], fallback: T) => (list.some((x) => x.v === v) ? (v as T) : fallback);
const cedi = (m: number) => formatMoney(m).replace(/\.00$/, "");

export default async function FindExperts({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const category = sp.category ?? "";
  const sort = pick(sp.sort, SORTS, "recommended");
  const budget = pick(sp.budget, BUDGETS, "");
  const delivery = pick(sp.delivery, DELIVERY, "");
  const level = pick(sp.level, LEVELS, "");
  const db = getDb();
  const [cats, results] = await Promise.all([categoryCounts(db), browseServices(db, { q, category, sort, budget, delivery, level })]);
  const activeCat = cats.find((c) => c.slug === category);
  const filtering = Boolean(budget || delivery || level);

  const view = sp.view === "experts" ? "experts" : "services";
  const experts = view === "experts" ? groupByExpert(results) : [];

  const href = (o: Partial<Record<"q" | "category" | "sort" | "budget" | "delivery" | "level" | "view", string>>) => {
    const p = new URLSearchParams();
    const m = { q, category, sort, budget, delivery, level, view, ...o };
    for (const [k, v] of Object.entries(m)) if (v && !(k === "sort" && v === "recommended") && !(k === "view" && v === "services")) p.set(k, v);
    const s = p.toString();
    return s ? `/services?${s}` : "/services";
  };
  const filters = (
    <>
      <FilterRow label="Price" items={BUDGETS.map((b) => ({ label: b.label, href: href({ budget: b.v }), on: budget === b.v }))} />
      <FilterRow label="Delivery" items={DELIVERY.map((d) => ({ label: d.label, href: href({ delivery: d.v }), on: delivery === d.v }))} />
      <FilterRow label="Expert" items={LEVELS.map((l) => ({ label: l.label, href: href({ level: l.v }), on: level === l.v }))} />
    </>
  );
  const count = view === "experts" ? `${experts.length} expert${experts.length === 1 ? "" : "s"}` : `${results.length} service${results.length === 1 ? "" : "s"}`;

  return (
    <>
      {/* ───── Search header: short, so results show straight away ───── */}
      <section className="bg-green text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pt-5 pb-0 sm:px-6 sm:pt-8">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
            <h1 className="text-2xl font-extrabold text-white sm:text-4xl">Find an expert</h1>
            <p className="hidden text-sm text-on-green-muted sm:block">Vetted statisticians, editors and methodologists · pay one stage at a time</p>
            <a href="/help#experts" className="text-sm font-bold text-amber no-underline hover:underline">▶ How hiring works (1 min)</a>
          </div>
          <form action="/services" className="flex gap-2 rounded-[14px] bg-white p-1.5 shadow-lg" role="search">
            {category && <input type="hidden" name="category" value={category} />}
            {view === "experts" && <input type="hidden" name="view" value="experts" />}
            <label htmlFor="q" className="sr-only">Search experts and services</label>
            <span className="flex items-center pl-2 text-ink-muted"><Icon name="search" size={18} /></span>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="e.g. Stata regression, thesis editing" className="min-w-0 flex-1 py-2.5 text-ink outline-none" />
            <button className="btn-primary px-4 py-2">Search</button>
          </form>
          <nav aria-label="Show" className="flex gap-1">
            {([["services", "Services"], ["experts", "Experts"]] as const).map(([v, label]) => (
              <Link key={v} href={href({ view: v })} aria-current={view === v ? "page" : undefined} className={`rounded-t-md px-5 py-2.5 text-sm font-bold no-underline ${view === v ? "bg-parchment text-ink" : "text-on-green-muted hover:text-white"}`}>{label}</Link>
            ))}
          </nav>
        </div>
      </section>

      <section className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
        {/* subjects as a scrolling chip row */}
        <nav aria-label="Subjects" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <Link href={href({ category: "" })} aria-current={!category ? "true" : undefined} className={chip(!category)}>All subjects</Link>
          {cats.map((c) => (
            <Link key={c.id} href={href({ category: category === c.slug ? "" : c.slug })} aria-current={category === c.slug ? "true" : undefined} className={chip(category === c.slug)}>
              <Icon name={iconFor(c.slug)} size={15} /> {c.name}{c.n ? <span className="opacity-60">{c.n}</span> : null}
            </Link>
          ))}
        </nav>
        {!q && !category && (
          <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 text-sm sm:mx-0 sm:flex-wrap sm:px-0">
            <span className="flex-none text-ink-muted">Popular:</span>
            {POPULAR_SEARCHES.map((p) => (
              <Link key={p} href={href({ q: p })} className="flex-none rounded-full bg-white px-3 py-1 text-ink no-underline ring-1 ring-line hover:ring-green">{p}</Link>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div>
            <h2 className="text-xl font-bold sm:text-2xl">{activeCat ? activeCat.name : q ? `Results for “${q}”` : view === "experts" ? "All experts" : "All services"}</h2>
            <p className="text-sm text-ink-muted">
              {count}
              {(filtering || q || category) && <> · <Link href={href({ q: "", category: "", budget: "", delivery: "", level: "" })} className="font-bold text-green">Clear all</Link></>}
            </p>
          </div>
          <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 text-sm sm:mx-0 sm:rounded-full sm:border sm:border-line sm:bg-white sm:p-1 sm:px-1" aria-label="Sort">
            {SORTS.map((s) => (
              <Link key={s.v} href={href({ sort: s.v })} aria-current={sort === s.v ? "true" : undefined} className={`flex-none rounded-full px-3 py-1.5 font-bold no-underline ${sort === s.v ? "bg-green text-white" : "text-ink"}`}>{s.label}</Link>
            ))}
          </nav>
        </div>

        <details className="rounded-md border border-line bg-white text-sm sm:hidden" open={filtering}>
          <summary className="cursor-pointer px-4 py-3 font-bold">Filters{filtering ? " · on" : ""}</summary>
          <div className="flex flex-col gap-3 border-t border-line px-4 py-3">{filters}</div>
        </details>
        <div className="hidden flex-wrap gap-x-6 gap-y-3 rounded-md border border-line bg-white px-4 py-3 text-sm sm:flex">{filters}</div>

        {(view === "experts" ? experts.length : results.length) === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-line bg-white/60 px-6 py-14 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-amber-tint text-amber-deep"><Icon name="search" size={28} /></span>
            <h3 className="text-xl font-bold">No {view} match yet</h3>
            <p className="max-w-md text-ink-muted">Describe what you need and let vetted experts come to you with a price and a plan.</p>
            <Link href="/jobs/new" className="btn-primary">Post a job instead</Link>
          </div>
        ) : view === "experts" ? (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {experts.map((e) => (
              <li key={e.userId}><ExpertCard e={e} /></li>
            ))}
          </ul>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((s, i) => (
              <Fragment key={s.id}>
                {i === 8 && (
                  <li key="cta" className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
                    <PostJobBanner />
                  </li>
                )}
                <li>
                  <ServiceCard s={s} />
                </li>
              </Fragment>
            ))}
          </ul>
        )}
        {(view === "experts" ? experts.length : results.length) > 0 && (view === "experts" || results.length <= 8) && <PostJobBanner />}
      </section>
    </>
  );
}

const chip = (on: boolean) => `inline-flex flex-none items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold no-underline ring-1 ${on ? "bg-green text-white ring-green" : "bg-white text-ink ring-line hover:ring-green"}`;

function ExpertCard({ e }: { e: BrowseExpert }) {
  return (
    <div className="flex h-full flex-col gap-3 rounded-md border border-line bg-white p-4 transition-shadow hover:shadow-lg">
      <Link href={`/experts/${e.userId}`} className="flex items-start gap-3 text-ink no-underline">
        <Avatar name={e.name ?? "?"} size={56} userId={e.userId} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <b className="font-display text-lg leading-tight">{e.name}</b>
            <span className="rounded-full bg-amber-tint px-2 py-0.5 text-[11px] font-bold text-amber-deep">{LEVEL_LABEL[e.level]}</span>
          </div>
          <p className="line-clamp-2 text-sm text-ink-muted">{e.headline}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            <Stars rating={e.rating} count={e.reviews} small />
            <span className="inline-flex items-center gap-1 text-green"><span aria-hidden="true">✓</span> Verified</span>
            {e.orders > 0 && <span>{e.orders} order{e.orders === 1 ? "" : "s"} done</span>}
          </div>
        </div>
      </Link>
      <div className="flex flex-wrap gap-1.5">
        {e.categories.slice(0, 3).map((c) => <span key={c} className="rounded-full bg-parchment px-2.5 py-0.5 text-[12px] font-bold">{c}</span>)}
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-sm border border-line text-sm">
        {e.services.slice(0, 2).map((s) => (
          <li key={s.id}>
            <Link href={`/services/${s.id}`} className="flex items-center gap-3 px-3 py-2 text-ink no-underline hover:bg-parchment">
              <span className="line-clamp-1 flex-1">{s.title}</span>
              <span className="flex-none text-xs text-ink-muted">from <b className="text-ink">{cedi(s.fromMinor)}</b></span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="text-xs text-ink-muted">{e.services.length} service{e.services.length === 1 ? "" : "s"} · from <b className="text-ink">{cedi(e.fromMinor)}</b> · {e.fastestDays}-day delivery</span>
        <Link href={`/experts/${e.userId}`} className="btn-outline flex-none px-3 py-1.5 text-sm">View profile</Link>
      </div>
    </div>
  );
}

function FilterRow({ label, items }: { label: string; items: { label: string; href: string; on: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-bold tracking-wide text-ink-muted uppercase">{label}</span>
      {items.map((i) => (
        <Link key={i.label} href={i.href} aria-current={i.on ? "true" : undefined} className={`rounded-full px-3 py-1 font-medium no-underline ${i.on ? "bg-green-tint font-bold text-green" : "text-ink hover:bg-parchment"}`}>{i.label}</Link>
      ))}
    </div>
  );
}

function ServiceCard({ s }: { s: BrowseService }) {
  const c = coverFor(s.categorySlug);
  return (
    <Link href={`/services/${s.id}`} className="group flex h-full flex-col overflow-hidden rounded-md border border-line bg-white text-ink no-underline transition-all hover:-translate-y-1 hover:shadow-xl">
      <div className="relative flex h-24 items-end justify-between overflow-hidden p-4 sm:h-32" style={{ background: c.bg, color: c.fg }}>
        <span className="absolute -top-6 -right-6 size-28 rounded-full" style={{ background: c.dot }} aria-hidden="true" />
        <span className="absolute top-8 right-16 size-10 rounded-full" style={{ background: c.dot }} aria-hidden="true" />
        <span className="relative transition-transform group-hover:scale-110"><Icon name={iconFor(s.categorySlug)} size={40} /></span>
        <span className="relative flex flex-col items-end gap-1">
          {s.isNew && <span className="rounded-full bg-amber px-2.5 py-0.5 text-[11px] font-bold text-ink">New</span>}
          <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold text-ink">{s.fastestDays}-day delivery</span>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-center gap-2 text-sm">
          <Avatar name={s.expertName ?? "?"} size={28} userId={s.expertUserId} />
          <b className="truncate">{s.expertName}</b>
          <span className="ml-auto flex-none rounded-full bg-parchment px-2 py-0.5 text-[11px] font-bold">{LEVEL_LABEL[s.level]}</span>
        </div>
        <h3 className="line-clamp-2 font-sans text-[15px] leading-snug font-bold group-hover:text-green">{s.title}</h3>
        <span className="text-xs font-bold tracking-wide text-green uppercase">{s.categoryName}</span>
        <div className="mt-auto flex items-end justify-between border-t border-line pt-3">
          <Stars rating={s.rating} count={s.reviews} small />
          <span className="text-right text-xs text-ink-muted">From <b className="font-display text-lg text-ink">{cedi(s.fromMinor)}</b></span>
        </div>
      </div>
    </Link>
  );
}

function PostJobBanner() {
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-amber-tint p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-8">
      <span className="hidden size-14 flex-none place-items-center rounded-full bg-amber text-ink sm:grid"><Icon name="briefcase" size={26} /></span>
      <div className="min-w-0 sm:flex-1">
        <h3 className="text-lg font-bold sm:text-xl">Not sure which package fits?</h3>
        <p className="text-sm text-ink-muted sm:text-base">Post a job for free. Matching experts are alerted straight away and send you proposals with a price and a plan.</p>
      </div>
      <Link href="/jobs/new" className="btn-primary sm:flex-none">Post a job</Link>
    </div>
  );
}
