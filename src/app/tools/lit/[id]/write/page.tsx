import { notFound, redirect } from "next/navigation";
import { WriteView } from "@/components/lit/WriteView";
import { getDb } from "@/db";
import { type Style, isStyle } from "@/lib/cite";
import { requireUser } from "@/server/guards";
import { getAnalysisState, getReview, listPapers } from "@/server/lit";
import { type WriteState, criticalCheck } from "@/server/litAnalysis";
import { aiOn } from "@/server/qualAnalysis";
import { canUse, toolAccessFor } from "@/server/toolAccess";

export const metadata = { title: "Write · Literature Review" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function WritePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const r = await getReview(db, user.id, id);
  if (!r) notFound();
  if (r.role !== "owner") redirect(`/tools/lit/${id}`);
  const papers = await listPapers(db, id, { status: "ACCEPTED" });
  const state = await getAnalysisState<WriteState>(db, id);
  return (
    <WriteView
      reviewId={id}
      state={state}
      papers={papers.map((p) => ({ n: p.n, meta: p.meta }))}
      style={(isStyle(r.style) ? r.style : "apa") as Style}
      warnings={criticalCheck(state, papers)}
      canRun={canUse(await toolAccessFor(db, "lit", user))}
      aiOn={aiOn()}
    />
  );
}
