import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { listCategories, searchServices } from "@/server/services";

export const metadata: Metadata = { title: "Find an expert" };
export const dynamic = "force-dynamic";

const LEVEL: Record<string, string> = { NEW: "New expert", LEVEL_1: "Level 1", LEVEL_2: "Level 2", TOP_RATED: "Top rated" };

export default async function Marketplace({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const { q = "", category = "" } = await searchParams;
  const db = getDb();
  const [cats, results] = await Promise.all([listCategories(db), searchServices(db, { q, category: category || undefined })]);
  const activeCat = cats.find((c) => c.slug === category);

  return (
    <>
      <section className="bg-green text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-10 sm:px-6 sm:py-14">
          <h1 className="text-3xl font-extrabold sm:text-5xl">Find a vetted expert</h1>
          <form action="/services" className="flex max-w-2xl flex-wrap gap-2 rounded-[18px] bg-white p-2" role="search">
            {category && <input type="hidden" name="category" value={category} />}
            <label htmlFor="q" className="sr-only">Search services</label>
            <input id="q" name="q" defaultValue={q} placeholder="e.g. regression analysis in Stata" className="min-w-0 flex-[1_1_220px] px-3 py-3 text-ink outline-none" />
            <button className="btn-primary flex-[1_1_auto] sm:flex-none">Search</button>
          </form>
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <nav aria-label="Categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <Link href={q ? `/services?q=${encodeURIComponent(q)}` : "/services"} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold no-underline ${!category ? "bg-green text-white" : "border border-line bg-white text-ink"}`}>
            All
          </Link>
          {cats.map((c) => (
            <Link
              key={c.id}
              href={`/services?category=${c.slug}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold no-underline ${category === c.slug ? "bg-green text-white" : "border border-line bg-white text-ink"}`}
            >
              {c.name}
            </Link>
          ))}
        </nav>

        <p className="text-sm text-ink-muted">
          {results.length} service{results.length === 1 ? "" : "s"}
          {activeCat ? ` in ${activeCat.name}` : ""}
          {q ? ` matching “${q}”` : ""}
        </p>

        {results.length === 0 ? (
          <div className="card flex flex-col items-start gap-3">
            <h2 className="text-xl font-bold">No services here yet</h2>
            <p className="text-ink-muted">Our experts are setting up their services. Try another category, or check back soon.</p>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((s) => (
              <li key={s.id}>
                <Link href={`/services/${s.id}`} className="card flex h-full flex-col gap-3 text-ink no-underline transition-shadow hover:shadow-md">
                  <span className="text-xs font-bold tracking-wide text-green uppercase">{s.categoryName}</span>
                  <h2 className="font-display text-lg leading-snug font-bold">{s.title}</h2>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="grid size-8 place-items-center rounded-full bg-green text-xs font-bold text-amber" aria-hidden="true">
                      {(s.expertName ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </span>
                    <span className="font-bold">{s.expertName}</span>
                    <span className="text-ink-muted">· {LEVEL[s.level]}</span>
                  </div>
                  <div className="mt-auto flex items-end justify-between border-t border-line pt-3 text-sm">
                    <span className="text-ink-muted">{s.fastestDays}-day delivery</span>
                    <span>From <b className="font-display text-lg">{formatMoney(s.fromMinor)}</b></span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
