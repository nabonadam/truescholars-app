import type { Metadata } from "next";
import { ServiceForm } from "@/components/ServiceForm";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { listCategories } from "@/server/services";

export const metadata: Metadata = { title: "Create a service" };
export const dynamic = "force-dynamic";

export default async function NewService() {
  await requireUser("EXPERT");
  const categories = await listCategories(getDb());
  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Expert</span>
        <h1 className="text-3xl font-bold">Create a service</h1>
        <p className="text-ink-muted">Clear packages sell best: say exactly what the client gets, by when, and how many revisions.</p>
      </div>
      <ServiceForm categories={categories} />
    </section>
  );
}
