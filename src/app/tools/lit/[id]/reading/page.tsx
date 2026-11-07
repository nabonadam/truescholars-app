import { notFound, redirect } from "next/navigation";
import { Reading } from "@/components/lit/Reading";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { getReview, listPapers } from "@/server/lit";
import type { Card } from "@/server/litAnalysis";
import { aiOn } from "@/server/qualAnalysis";
import { canUse, toolAccessFor } from "@/server/toolAccess";

export const metadata = { title: "Reading · Literature Review" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ReadingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const r = await getReview(db, user.id, id);
  if (!r) notFound();
  if (r.role !== "owner") redirect(`/tools/lit/${id}`);
  const papers = await listPapers(db, id, { status: "ACCEPTED" });
  return (
    <Reading
      reviewId={id}
      papers={papers.map((p) => ({ id: p.id, n: p.n, meta: p.meta, card: (p.card as Card | null) ?? null, cardStatus: p.cardStatus, cardError: p.cardError, hasFile: !!p.fileKey }))}
      canRun={canUse(await toolAccessFor(db, "lit", user))}
      aiOn={aiOn()}
    />
  );
}
