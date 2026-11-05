import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ServiceForm } from "@/components/ServiceForm";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { getService, listCategories } from "@/server/services";

export const metadata: Metadata = { title: "Edit service" };
export const dynamic = "force-dynamic";

export default async function EditService({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("EXPERT");
  const { id } = await params;
  const db = getDb();
  const [svc, categories] = await Promise.all([getService(db, id), listCategories(db)]);
  if (!svc || svc.expert.userId !== user.id) notFound();

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Expert</span>
        <h1 className="text-3xl font-bold">Edit service</h1>
      </div>
      <ServiceForm
        categories={categories}
        initial={{
          id: svc.service.id,
          title: svc.service.title,
          categoryId: svc.service.categoryId,
          description: svc.service.description,
          requirements: svc.service.requirements,
          tiers: svc.tiers,
        }}
      />
    </section>
  );
}
