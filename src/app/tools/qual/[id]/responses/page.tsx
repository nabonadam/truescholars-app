import { notFound } from "next/navigation";
import { Responses } from "@/components/qual/Responses";
import { getDb } from "@/db";
import { answerable, questionNumbers } from "@/lib/qual";
import { requireUser } from "@/server/guards";
import { getStudy, listResponses, studySettings, transcriptionOn, usable } from "@/server/qual";
import { fieldQuestions } from "@/server/qualExport";
import { storageKind } from "@/server/qualStorage";
import { aiOn } from "@/server/qualAnalysis";
import { pendingTranslations } from "@/server/qualTranslate";
import { canUse, toolAccessFor } from "@/server/toolAccess";

export const metadata = { title: "Responses · Qualitative Studio" };

export default async function StudyResponses({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const s = await getStudy(db, user.id, id);
  if (!s) notFound();
  const rs = await listResponses(db, user.id, id);
  const qs = fieldQuestions(s);
  const nums = questionNumbers(qs);
  const good = usable(rs);

  // breakdowns of the closed questions, over usable responses
  const charts = answerable(qs)
    .filter((q) => q.type === "choice" || q.type === "dropdown" || q.type === "multi" || q.type === "rating")
    .map((q) => {
      const options = q.type === "rating" ? Array.from({ length: q.scaleMax }, (_, i) => String(i + 1)) : q.options;
      const counts = Object.fromEntries(options.map((o) => [o, 0]));
      let answered = 0;
      for (const r of good) {
        const a = r.answers[q.id];
        const picked = q.type === "multi" ? (a?.choices ?? []) : q.type === "rating" ? (a?.rating ? [String(a.rating)] : []) : a?.choice ? [a.choice] : [];
        if (picked.length) answered++;
        for (const p of picked) counts[p] = (counts[p] ?? 0) + 1;
      }
      return { id: q.id, n: nums[q.id], text: q.text, multi: q.type === "multi", answered, bars: Object.entries(counts).filter(([, v], i) => v > 0 || options.length <= 12 || i < 12).map(([label, value]) => ({ label, value })) };
    });

  const days: Record<string, number> = {};
  for (const r of good) if (r.submittedAt) days[r.submittedAt.toISOString().slice(0, 10)] = (days[r.submittedAt.toISOString().slice(0, 10)] ?? 0) + 1;
  const voiceAnswers = good.flatMap((r) => Object.values(r.answers).filter((a) => a.audio));
  const access = await toolAccessFor(db, "qual", user);

  return (
    <Responses
      studyId={id}
      questions={qs}
      language={studySettings(s).language}
      translate={studySettings(s).translate && aiOn()}
      toTranslate={pendingTranslations(qs, good)}
      canWork={canUse(access)}
      transcriptionOn={transcriptionOn()}
      storage={storageKind()}
      charts={charts}
      days={Object.entries(days).sort().map(([d, n]) => ({ d, n }))}
      totals={{
        submitted: good.length,
        inProgress: rs.filter((r) => r.status !== "SUBMITTED" && !r.flagged).length,
        test: rs.filter((r) => r.flagged).length,
        recordings: voiceAnswers.length,
        transcribed: voiceAnswers.filter((a) => a.tStatus === "done" || a.tStatus === "edited").length,
        minutes: Math.round(voiceAnswers.reduce((t, a) => t + (a.audio?.seconds ?? 0), 0) / 60),
      }}
      responses={rs.map((r) => ({ id: r.id, n: r.n, name: r.name, email: r.email, status: r.status, flagged: r.flagged, tags: r.tags, startedAt: r.startedAt.toISOString(), submittedAt: r.submittedAt?.toISOString() ?? null, answers: r.answers }))}
    />
  );
}
