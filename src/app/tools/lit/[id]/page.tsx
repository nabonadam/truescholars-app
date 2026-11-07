import { Papers, type PaperView } from "@/components/lit/Papers";
import { ExpertPanel, RetrievalCard } from "@/components/lit/Retrieval";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { getReview, listPapers } from "@/server/lit";
import { assignmentInfo } from "@/server/litRetrieval";
import { canUse, toolAccessFor } from "@/server/toolAccess";
import { notFound } from "next/navigation";

export const metadata = { title: "Papers · Literature Review" };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function PapersPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const r = await getReview(db, user.id, id);
  if (!r) notFound();
  const papers = await listPapers(db, id);
  const view: PaperView[] = papers.map((p) => ({ id: p.id, n: p.n, source: p.source, status: p.status, rejectReason: p.rejectReason, fileName: p.fileName, hasFile: !!p.fileKey, pages: p.pages, meta: p.meta, verify: p.verify, note: p.note, cardStatus: p.cardStatus }));
  const assignment = await assignmentInfo(db, r);
  const canWork = r.role === "expert" ? r.status === "RETRIEVAL" && (assignment?.paid ?? true) : canUse(await toolAccessFor(db, "lit", user));
  return (
    <div className="flex flex-col gap-6">
      {r.role === "owner" ? <RetrievalCard review={r} assignment={assignment} /> : <ExpertPanel review={r} papers={view.length} assignment={assignment} />}
      <Papers reviewId={id} papers={view} role={r.role} canWork={canWork} />
    </div>
  );
}
