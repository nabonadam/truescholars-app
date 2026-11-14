import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpertReviews } from "@/components/ExpertReviews";
import { Icon } from "@/components/Icons";
import { Avatar, LEVEL_LABEL } from "@/components/People";
import { getDb } from "@/db";
import { coverFor, iconFor } from "@/lib/categoryIcons";
import { formatMoney } from "@/lib/money";
import { expertPublicProfile } from "@/server/browse";
import { expertReviewSummary } from "@/server/reviews";

export const dynamic = "force-dynamic";
const cedi = (m: number) => formatMoney(m).replace(/\.00$/, "");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = await expertPublicProfile(getDb(), (await params).id).catch(() => null);
  return { title: p ? `${p.name} · Expert` : "Expert" };
}

export default async function ExpertProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const p = await expertPublicProfile(db, id).catch(() => null);
  if (!p) notFound();
  const reviews = await expertReviewSummary(db, id);
  const first = p.name?.split(" ")[0] ?? "this expert";

  return (
    <>
      <section className="bg-green text-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
          <Link href="/services?view=experts" className="text-sm font-bold text-amber no-underline">← All experts</Link>
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <Avatar name={p.name ?? "?"} size={88} userId={p.userId} src={p.image} tone="amber" />
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-extrabold text-white sm:text-4xl">{p.name}</h1>
              <p className="text-on-green-muted">{p.headline}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-amber px-3 py-1 text-ink">{LEVEL_LABEL[p.level]}</span>
                <span className="rounded-full bg-white/10 px-3 py-1">✓ Credentials verified</span>
                {reviews.total > 0 && <span className="rounded-full bg-white/10 px-3 py-1">★ {reviews.average?.toFixed(1)} ({reviews.total})</span>}
                {p.completed > 0 && <span className="rounded-full bg-white/10 px-3 py-1">{p.completed} order{p.completed === 1 ? "" : "s"} completed</span>}
                {p.country && <span className="rounded-full bg-white/10 px-3 py-1">{p.country}</span>}
                <span className="rounded-full bg-white/10 px-3 py-1">Member since {p.memberSince.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        {(p.bio || (p.skills?.length ?? 0) > 0) && (
          <div className="card flex flex-col gap-3">
            <h2 className="text-xl font-bold">About {first}</h2>
            {p.bio && <p className="whitespace-pre-line">{p.bio}</p>}
            {(p.skills?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {p.skills!.map((k) => <span key={k} className="rounded-full bg-parchment px-3 py-1 text-sm font-bold">{k}</span>)}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">{first}&apos;s services</h2>
          {p.services.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {p.services.map((s) => {
                const c = coverFor(s.categorySlug);
                return (
                  <li key={s.id}>
                    <Link href={`/services/${s.id}`} className="group flex h-full flex-col overflow-hidden rounded-md border border-line bg-white text-ink no-underline hover:shadow-lg">
                      <div className="flex h-16 items-center justify-between px-4" style={{ background: c.bg, color: c.fg }}>
                        <Icon name={iconFor(s.categorySlug)} size={26} />
                        <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold text-ink">{s.fastestDays}-day delivery</span>
                      </div>
                      <div className="flex flex-1 flex-col gap-2 p-4">
                        <span className="text-xs font-bold tracking-wide text-green uppercase">{s.categoryName}</span>
                        <h3 className="line-clamp-2 font-sans text-[15px] leading-snug font-bold group-hover:text-green">{s.title}</h3>
                        <span className="mt-auto text-sm text-ink-muted">From <b className="font-display text-lg text-ink">{cedi(s.fromMinor)}</b></span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-ink-muted">{first} has no live services right now. Post a job and invite proposals instead.</p>
          )}
        </div>

        <ExpertReviews reviews={reviews} firstName={first} />

        <div className="flex flex-col gap-4 rounded-lg bg-amber-tint p-5 sm:flex-row sm:items-center">
          <div className="min-w-0 sm:flex-1">
            <h2 className="text-lg font-bold">Need something different?</h2>
            <p className="text-sm text-ink-muted">Post a job with your brief and budget. {first} and other matching experts can send you a proposal. Payment is held in escrow until you approve the work.</p>
          </div>
          <Link href="/jobs/new" className="btn-primary sm:flex-none">Post a job</Link>
        </div>
      </div>
    </>
  );
}
