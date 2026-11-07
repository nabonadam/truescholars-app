import { Analyse } from "@/components/qual/Analyse";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { aiOn, cases, getAnalysis } from "@/server/qualAnalysis";
import { canUse, toolAccessFor } from "@/server/toolAccess";

export const metadata = { title: "Analyse · Qualitative Studio" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function AnalysePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const { list } = await cases(db, user.id, id);
  const a = await getAnalysis(db, id);
  const access = await toolAccessFor(db, "qual", user);
  return (
    <Analyse
      studyId={id}
      participants={list.map((c) => ({ rid: c.rid, pid: c.pid, words: c.words }))}
      researchQuestion={a.researchQuestion}
      background={a.background}
      state={a.state}
      canRun={canUse(access)}
      aiOn={aiOn()}
    />
  );
}
