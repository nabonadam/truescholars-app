import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/components/Icons";
import { Avatar, LEVEL_LABEL, Stars } from "@/components/People";
import { getDb } from "@/db";
import { coverFor, iconFor, POPULAR_SEARCHES } from "@/lib/categoryIcons";
import { formatMoney } from "@/lib/money";
import { browseServices, categoryCounts, type BrowseService, type Budget, type Delivery, type LevelFilter, type Sort } from "@/server/browse";

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
  const browsing = !q && !category && !filtering;

  const href = (o: Partial<Record<"q" | "category" | "sort" | "budget" | "delivery" | "level", string>>) => {
    const p = new URLSearchParams();
    const m = { q, category, sort, budget, delivery, level, ...o };
    for (const [k, v] of Object.entries(m)) if (v && !(k === "sort" && v === "recommended")) p.set(k, v);
    const s = p.toString();
    return s ? `/services?${s}` : "/services";
  };

  // A few distinct experts to introduce on the landing view
  const seen = new Set<string>();
  const experts = [...results].sort((a, b) => b.score - a.score).filter((s) => !seen.has(s.expertUserId) && seen.add(s.expertUserId)).slice(0, 4);
  const showcase = results.slice(0, 3);

  return (
    <>
      {/* ───── Hero ───── */}
      <section className="relative overflow-hidden bg-green text-white">
        <div className="pointer-events-none absolute -top-32 -left-24 size-[28rem] rounded-full bg-white/[.04]" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-24 -bottom-40 size-[30rem] rounded-full bg-amber/10" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex flex-col gap-5">
            <span className="text-xs font-bold tracking-wider text-amber uppercase">Find an expert</span>
            <h1 className="text-4xl leading-[1.02] font-extrabold text-white sm:text-6xl">
              The right expert for <span className="text-amber">your research.</span>
            </h1>
            <p className="max-w-xl text-lg text-on-green-muted">Statisticians, editors and methodologists whose credentials we&apos;ve checked. Pay into escrow; release it only when you&apos;re happy.</p>
            <form action="/services" className="flex max-w-2xl flex-wrap gap-2 rounded-[18px] bg-white p-2 shadow-xl" role="search">
              {category && <input type="hidden" name="category" value={category} />}
              <label htmlFor="q" className="sr-only">What do you need help with?</label>
              <span className="hidden items-center pl-3 text-ink-muted sm:flex"><Icon name="search" size={20} /></span>
              <input id="q" name="q" defaultValue={q} placeholder="What do you need help with?" className="min-w-0 flex-[1_1_200px] px-2 py-3 text-ink outline-none" />
              <button className="btn-primary flex-[1_1_auto] sm:flex-none">Search</button>
            </form>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-on-green-muted">Popular:</span>
              {POPULAR_SEARCHES.map((p) => (
                <Link key={p} href={`/services?q=${encodeURIComponent(p)}`} className="rounded-full border border-white/25 px-3 py-1 text-white no-underline hover:border-amber hover:text-amber">{p}</Link>
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-on-green-muted">
              {["Credentials verified", "Money held in escrow", "Revisions included"].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5"><span className="grid size-5 place-items-center rounded-full bg-amber text-[11px] font-bold text-ink">✓</span>{t}</li>
              ))}
            </ul>
          </div>

          {/* A small collage of real services */}
          <div className="relative hidden h-[26rem] lg:block" aria-hidden="true">
            {showcase.map((s, i) => {
              const c = coverFor(s.categorySlug);
              const pos = ["top-0 left-4 -rotate-[4deg] z-0", "top-14 right-0 rotate-[3deg] z-10", "bottom-0 left-24 -rotate-[1deg] z-20"][i];
              return (
                <div key={s.id} className={`absolute w-64 overflow-hidden rounded-md bg-white text-ink shadow-2xl ${pos}`}>
                  <div className="flex h-20 items-center justify-between px-4" style={{ background: c.bg, color: c.fg }}>
                    <Icon name={iconFor(s.categorySlug)} size={30} />
                    <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold text-ink">{s.fastestDays}-day delivery</span>
                  </div>
                  <div className="flex flex-col gap-1.5 p-3.5">
                    <div className="flex items-center gap-2 text-xs"><Avatar name={s.expertName ?? "?"} size={22} /><b>{s.expertName}</b></div>
                    <div className="line-clamp-2 text-sm font-bold">{s.title}</div>
                    <div className="text-xs text-ink-muted">From <b className="text-ink">{cedi(s.fromMinor)}</b></div>
                  </div>
                </div>
              );
            })}
            {showcase.length === 0 && (
              <div className="absolute inset-8 grid place-items-center rounded-lg border-2 border-dashed border-white/20 text-on-green-muted">Experts are setting up their services</div>
            )}
          </div>
        </div>
      </section>

      {/* ───── Categories ───── */}
      <section className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pt-8 sm:px-6">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-2xl font-bold">Browse by subject</h2>
          {category && <Link href={href({ category: "" })} className="text-sm font-bold text-green">All subjects</Link>}
        </div>
        <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
          {cats.map((c) => {
            const on = category === c.slug;
            return (
              <li key={c.id} className="w-40 flex-none snap-start sm:w-auto">
                <Link
                  href={href({ category: on ? "" : c.slug })}
                  aria-current={on ? "true" : undefined}
                  className={`flex h-full flex-col gap-3 rounded-md border p-4 no-underline transition-all hover:-translate-y-0.5 hover:shadow-md ${on ? "border-green bg-green text-white" : "border-line bg-white text-ink"}`}
                >
                  <span className={`grid size-10 place-items-center rounded-sm ${on ? "bg-amber text-ink" : "bg-green-tint text-green"}`}><Icon name={iconFor(c.slug)} size={20} /></span>
                  <span className="text-sm leading-snug font-bold">{c.name}</span>
                  <span className={`mt-auto text-xs ${on ? "text-on-green-muted" : "text-ink-muted"}`}>{c.n ? `${c.n} service${c.n === 1 ? "" : "s"}` : "Coming soon"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ───── Experts to meet ───── */}
      {browsing && experts.length > 1 && (
        <section className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pt-10 sm:px-6">
          <h2 className="text-2xl font-bold">Meet some of our experts</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {experts.map((s) => (
              <li key={s.expertUserId}>
                <Link href={`/services/${s.id}`} className="flex h-full flex-col items-center gap-2 rounded-md border border-line bg-white p-5 text-center text-ink no-underline transition-shadow hover:shadow-lg">
                  <Avatar name={s.expertName ?? "?"} size={64} />
                  <b className="font-display text-lg">{s.expertName}</b>
                  <span className="line-clamp-2 text-sm text-ink-muted">{s.expertHeadline}</span>
                  <span className="mt-auto flex flex-wrap items-center justify-center gap-2 text-xs">
                    <span className="rounded-full bg-amber-tint px-2.5 py-0.5 font-bold text-amber-deep">{LEVEL_LABEL[s.level]}</span>
                    <Stars rating={s.rating} count={s.reviews} small />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ───── Results ───── */}
      <section className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">{activeCat ? activeCat.name : q ? `Results for “${q}”` : "All services"}</h2>
            <p className="text-sm text-ink-muted">
              {results.length} service{results.length === 1 ? "" : "s"}
              {(filtering || q) && <> · <Link href={href({ q: "", budget: "", delivery: "", level: "" })} className="font-bold text-green">Clear filters</Link></>}
            </p>
          </div>
          <nav className="flex flex-wrap gap-1 rounded-full border border-line bg-white p-1 text-sm" aria-label="Sort">
            {SORTS.map((s) => (
              <Link key={s.v} href={href({ sort: s.v })} aria-current={sort === s.v ? "true" : undefined} className={`rounded-full px-3 py-1.5 font-bold no-underline ${sort === s.v ? "bg-green text-white" : "text-ink"}`}>{s.label}</Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-md border border-line bg-white px-4 py-3 text-sm">
          <FilterRow label="Price" items={BUDGETS.map((b) => ({ label: b.label, href: href({ budget: b.v }), on: budget === b.v }))} />
          <FilterRow label="Delivery" items={DELIVERY.map((d) => ({ label: d.label, href: href({ delivery: d.v }), on: delivery === d.v }))} />
          <FilterRow label="Expert" items={LEVELS.map((l) => ({ label: l.label, href: href({ level: l.v }), on: level === l.v }))} />
        </div>

        {results.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-line bg-white/60 px-6 py-14 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-amber-tint text-amber-deep"><Icon name="search" size={28} /></span>
            <h3 className="text-xl font-bold">No services match yet</h3>
            <p className="max-w-md text-ink-muted">Describe what you need and let vetted experts come to you with a price and a plan.</p>
            <Link href="/jobs/new" className="btn-primary">Post a job instead</Link>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
        {results.length > 0 && results.length <= 8 && <PostJobBanner />}
      </section>
    </>
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
      <div className="relative flex h-32 items-end justify-between overflow-hidden p-4" style={{ background: c.bg, color: c.fg }}>
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
          <Avatar name={s.expertName ?? "?"} size={28} />
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
    <div className="flex flex-wrap items-center gap-5 rounded-lg bg-amber-tint p-6 sm:p-8">
      <span className="grid size-14 flex-none place-items-center rounded-full bg-amber text-ink"><Icon name="briefcase" size={26} /></span>
      <div className="min-w-0 flex-1">
        <h3 className="text-xl font-bold">Not sure which package fits?</h3>
        <p className="text-ink-muted">Post a job for free. Matching experts are alerted straight away and send you proposals with a price and a plan.</p>
      </div>
      <Link href="/jobs/new" className="btn-primary">Post a job</Link>
    </div>
  );
}
