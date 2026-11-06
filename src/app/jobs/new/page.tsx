import type { Metadata } from "next";
import { PostJobForm } from "@/components/JobForms";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { priceGuides } from "@/server/jobs";
import { listCategories } from "@/server/services";

export const metadata: Metadata = { title: "Post a job" };
export const dynamic = "force-dynamic";

export default async function NewJob() {
  await requireUser();
  const db = getDb();
  const [cats, guides] = await Promise.all([listCategories(db), priceGuides(db)]);
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Post a job</span>
        <h1 className="text-3xl font-bold sm:text-4xl">Tell us what you need</h1>
        <p className="max-w-2xl text-ink-muted">Verified experts will send you proposals with a price and a plan. Compare them side by side and hire the one you trust.</p>
      </div>
      <PostJobForm categories={cats.map((c) => ({ id: c.id, slug: c.slug, name: c.name }))} guides={guides} />
    </section>
  );
}
