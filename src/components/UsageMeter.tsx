import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { UNIT_LABEL, type UsageTool, usageStatus } from "@/server/usage";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** How much of this month's (or the trial's) fair-use allowance someone has used. */
export async function UsageMeter({ tool, dark = false }: { tool: UsageTool; dark?: boolean }) {
  const user = await requireUser();
  const s = await usageStatus(getDb(), user, tool);
  if (s.unlimited || s.access.kind === "ended") return null;
  const bars = [
    ...s.units.map((u) => ({ label: `${Math.floor(u.used).toLocaleString("en-GB")} of ${u.limit.toLocaleString("en-GB")} ${UNIT_LABEL[u.kind].many}`, pct: Math.min(100, (u.used / u.limit) * 100) })),
    { label: `AI allowance ${s.costUsedPct}% used`, pct: s.costUsedPct },
  ];
  const muted = dark ? "text-on-green-muted" : "text-ink-muted";
  return (
    <div className={`flex flex-col gap-2 text-[12.5px] ${muted}`}>
      <span className={`font-bold ${dark ? "text-white" : "text-ink"}`}>{s.access.kind === "trial" ? "Free trial allowance" : "This month"}{s.resetsAt ? ` · resets ${day(s.resetsAt)}` : ""}</span>
      {bars.map((b) => (
        <div key={b.label}>
          <div className={`h-1.5 overflow-hidden rounded-full ${dark ? "bg-white/15" : "bg-parchment"}`}>
            <div className={`h-full rounded-full ${b.pct >= 90 ? "bg-red-500" : b.pct >= 70 ? "bg-amber" : dark ? "bg-amber" : "bg-green"}`} style={{ width: `${Math.max(2, b.pct)}%` }} />
          </div>
          <span className="mt-0.5 block">{b.label}</span>
        </div>
      ))}
      {s.blocked && <span className="font-bold text-red-600">{s.blocked}</span>}
    </div>
  );
}
