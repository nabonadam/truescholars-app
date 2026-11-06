import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { getSession, listRuns } from "@/server/stats";
import { accessFor, canRun, timeLeft } from "@/server/statsAccess";
import { Workspace } from "@/components/stats/Workspace";

export const metadata = { title: "Statistics Assistant" };

export default async function StatsSession({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const session = await getSession(db, user.id, id);
  if (!session) notFound();
  const runs = await listRuns(db, id);
  const access = await accessFor(db, user);
  return (
    <Workspace
      session={{ id: session.id, title: session.title, fileName: session.fileName, nObs: session.nObs, nVars: session.nVars, history: session.history, variables: session.variables }}
      runs={runs.map((r) => ({ id: r.id, input: r.input, mode: r.mode, commands: r.commands, status: r.status, explanation: r.explanation, results: r.results, interpretation: r.interpretation, createdAt: r.createdAt.toISOString() }))}
      aiEnabled={!!process.env.ANTHROPIC_API_KEY}
      access={{
        canRun: canRun(access),
        label: access.kind === "trial" ? `Trial: ${timeLeft(access.endsAt)} left` : access.kind === "ended" ? "Trial ended" : null,
        urgent: access.kind === "trial" && access.endsAt.getTime() - Date.now() < 12 * 3_600_000,
      }}
    />
  );
}
