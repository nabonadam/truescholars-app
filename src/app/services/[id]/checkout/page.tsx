import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutForm } from "@/components/CheckoutForm";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/guards";
import { getService } from "@/server/services";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

const LABEL = { BASIC: "Basic", STANDARD: "Standard", PRO: "Pro" } as const;

export default async function Checkout({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tier?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { tier = "BASIC" } = await searchParams;
  const svc = await getService(getDb(), id);
  if (!svc || svc.service.status !== "ACTIVE") notFound();
  if (svc.expert.userId === user.id) redirect(`/services/${id}`);
  const t = svc.tiers.find((x) => x.name === tier);
  if (!t) notFound();

  return (
    <section className="mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[3fr_2fr]">
      <div className="card flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Checkout</span>
          <h1 className="text-2xl font-bold sm:text-3xl">Almost there</h1>
        </div>
        <CheckoutForm serviceId={id} tier={t.name} questions={svc.service.requirements} priceLabel={formatMoney(t.priceMinor)} />
      </div>

      <aside className="card flex h-fit flex-col gap-4">
        <h2 className="text-lg font-bold">Order summary</h2>
        <div>
          <div className="font-bold">{svc.service.title}</div>
          <div className="text-sm text-ink-muted">by {svc.expert.name}</div>
        </div>
        <dl className="flex flex-col gap-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between"><dt className="text-ink-muted">Package</dt><dd className="font-bold">{LABEL[t.name]}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">Delivery</dt><dd>{t.deliveryDays} days after payment</dd></div>
          <div className="flex justify-between"><dt className="text-ink-muted">Revisions</dt><dd>{t.revisions}</dd></div>
          <div className="flex justify-between border-t border-line pt-3 text-base"><dt className="font-bold">Total</dt><dd className="font-display text-xl font-bold">{formatMoney(t.priceMinor)}</dd></div>
        </dl>
        <Link href={`/services/${id}`} className="text-sm font-bold text-green">← Change package</Link>
      </aside>
    </section>
  );
}
