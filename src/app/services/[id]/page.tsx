import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { expertReviewSummary } from "@/server/orderRoom";
import { getService } from "@/server/services";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const svc = await getService(getDb(), id).catch(() => null);
  return { title: svc?.service.title ?? "Service" };
}

const TIER_LABEL = { BASIC: "Basic", STANDARD: "Standard", PRO: "Pro" } as const;

export default async function ServicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  const [svc, session] = await Promise.all([getService(getDb(), id), auth().catch(() => null)]);
  const isOwner = session?.user?.id === svc?.expert.userId;
  if (!svc || (svc.service.status !== "ACTIVE" && !isOwner)) notFound();
  const { service, expert, tiers } = svc;
  const reviews = await expertReviewSummary(getDb(), expert.userId);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      {saved && (
        <p role="status" className="rounded-sm bg-green-tint px-4 py-3 text-sm font-bold text-green">
          Service saved and live. This is how clients see it. <Link href="/expert/services" className="underline">Back to my services</Link>
        </p>
      )}
      {service.status !== "ACTIVE" && (
        <p className="rounded-sm bg-amber-tint px-4 py-3 text-sm text-amber-deep">This service is paused and hidden from clients.</p>
      )}

      <div className="flex flex-col gap-3">
        <Link href={`/services?category=${svc.categorySlug}`} className="eyebrow no-underline">{svc.categoryName}</Link>
        <h1 className="max-w-3xl text-3xl font-bold sm:text-4xl">{service.title}</h1>
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-green text-sm font-bold text-amber" aria-hidden="true">
            {(expert.name ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("")}
          </span>
          <div>
            <div className="font-bold">{expert.name}</div>
            <div className="text-sm text-ink-muted">
              {expert.headline}
              {expert.verifiedAt ? " · Verified expert" : ""}
              {reviews.total > 0 ? ` · ★ ${reviews.average?.toFixed(1)} (${reviews.total} review${reviews.total === 1 ? "" : "s"})` : " · No reviews yet"}
            </div>
          </div>
        </div>
      </div>

      <div className={`grid gap-4 ${tiers.length === 3 ? "lg:grid-cols-3" : tiers.length === 2 ? "md:grid-cols-2" : "max-w-md"}`}>
        {tiers.map((t) => (
          <div key={t.id} className={`card flex flex-col gap-4 ${t.name === "STANDARD" ? "border-green" : ""}`}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-bold">{TIER_LABEL[t.name]}</h2>
              <span className="font-display text-2xl font-bold">{formatMoney(t.priceMinor)}</span>
            </div>
            <div className="flex gap-4 text-sm text-ink-muted">
              <span>{t.deliveryDays}-day delivery</span>
              <span>{t.revisions} revision{t.revisions === 1 ? "" : "s"}</span>
            </div>
            {t.includes.length > 0 && (
              <ul className="flex flex-col gap-2 text-sm">
                {t.includes.map((inc) => (
                  <li key={inc} className="flex gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0f3d2a" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" className="mt-0.5 flex-none"><path d="M5 12l5 5 9-10" /></svg>
                    {inc}
                  </li>
                ))}
              </ul>
            )}
            {isOwner ? (
              <span className="mt-auto text-sm text-ink-muted">Your own service</span>
            ) : (
              <Link href={`/services/${service.id}/checkout?tier=${t.name}`} className="btn-primary mt-auto">
                Continue ({formatMoney(t.priceMinor)})
              </Link>
            )}
          </div>
        ))}
      </div>

      {reviews.recent.length > 0 && (
        <div className="card flex flex-col gap-4">
          <h2 className="text-xl font-bold">What clients say about {expert.name?.split(" ")[0]}</h2>
          <ul className="flex flex-col divide-y divide-line">
            {reviews.recent.map((r, i) => (
              <li key={i} className="flex flex-col gap-1 py-3">
                <span className="text-amber-deep" aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span>
                <p>{r.body}</p>
                <span className="text-xs text-ink-muted">{r.author?.split(" ")[0]} · {r.createdAt.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="card flex flex-col gap-3">
          <h2 className="text-xl font-bold">About this service</h2>
          <p className="whitespace-pre-line text-ink">{service.description}</p>
        </div>
        <div className="card flex flex-col gap-3">
          <h2 className="text-xl font-bold">How payment works</h2>
          <p className="text-sm text-ink-muted">
            You pay by Mobile Money or card. The money is held in escrow and only released to {expert.name?.split(" ")[0] ?? "the expert"} when you approve the delivery. Not right? Ask for a revision, and our team steps in if you can&apos;t agree.
          </p>
          {expert.skills.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {expert.skills.map((s) => (
                <span key={s} className="rounded-full bg-green-tint px-3 py-1 text-xs font-bold text-green">{s}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
