import { notFound, redirect } from "next/navigation";
import { BriefForm } from "@/components/lit/BriefForm";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { type Brief, getReview } from "@/server/lit";

export const metadata = { title: "Brief · Literature Review" };
export const dynamic = "force-dynamic";

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const r = await getReview(getDb(), user.id, id);
  if (!r) notFound();
  if (r.role !== "owner") redirect(`/tools/lit/${id}`);
  return <BriefForm id={id} title={r.title} researchQuestion={r.researchQuestion} brief={r.brief as Brief} style={r.style} locked={r.status === "RETRIEVAL"} />;
}
