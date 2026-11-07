/** Statistics Assistant: datasets, sessions and runs. The numbers come from the Python engine (stats/). */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { statDatasets, statRuns, statSessions } from "@/db/schema";
import { looksLikeStata, splitCommands } from "@/lib/stata";
import { AiUnavailable, interpret, translate, type VarMeta } from "./statsAi";

export class StatsError extends Error {}

/** Largest upload, in MB. The engine needs roughly the file's size in memory, so raise this
 * together with the engine's plan (about 100 MB fits the free 512 MB instance). */
export const maxDatasetMb = () => Math.max(1, Number(process.env.STATS_MAX_MB) || 100);
const EXTENSIONS = ["dta", "sav", "xlsx", "xls", "csv", "tsv", "txt"];

export type TableOut = { title: string; columns: string[]; rows: string[][]; note: string; groups: number[] };
export type CommandResult = {
  command: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
  log?: string;
  tables?: TableOut[];
  notes?: string[];
  summary?: Record<string, unknown>;
  changesData?: boolean;
  images?: { title: string; png: string; width?: number; height?: number }[];
};
type Overview = { nObs: number; nVars: number; variables: VarMeta[]; importNotes?: string[] };

// ───────── engine ─────────

const engineBase = () => process.env.STATS_URL?.replace(/\/$/, "");
const WAKE_MS = 100_000; // a sleeping free-plan engine takes 30-60 s to start
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits until the engine answers /health. On the free hosting plan it sleeps after ~15 minutes
 * without use, and while it starts the host answers 503 "loading" straight away.
 */
export async function ping(maxMs = WAKE_MS) {
  const base = engineBase();
  if (!base) return false;
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const ok = await fetch(base + "/health", { signal: AbortSignal.timeout(15_000), cache: "no-store" })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return true;
    await pause(2_500);
  }
  return false;
}

const WAKING = new Set([502, 503, 504]);

export async function engine<T>(route: string, body: unknown, raw = false): Promise<T> {
  const base = engineBase();
  if (!base) throw new StatsError("The statistics engine is not connected yet.");
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(base + route, {
        method: "POST",
        headers: { "content-type": "application/json", "x-stats-key": process.env.STATS_KEY ?? "" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
        cache: "no-store",
      });
    } catch {
      res = null; // unreachable: probably still starting
    }
    if (res && !WAKING.has(res.status)) {
      if (!res.ok) {
        const detail = await res.json().then((j: { detail?: string }) => j.detail).catch(() => null);
        throw new StatsError(typeof detail === "string" ? detail : "The statistics engine could not finish that. Try again.");
      }
      return (raw ? res.arrayBuffer() : res.json()) as Promise<T>;
    }
    // Asleep, starting or restarting: wait for it once, then try again.
    if (attempt >= 1 || !(await ping())) {
      throw new StatsError("The statistics engine is taking longer than usual to start. Please try again in a minute.");
    }
  }
}

// ───────── sessions ─────────

export function checkUpload(name: string, size: number) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!EXTENSIONS.includes(ext)) throw new StatsError("Upload a Stata (.dta), SPSS (.sav), Excel (.xlsx) or CSV file.");
  if (size === 0) throw new StatsError("That file is empty.");
  if (size > maxDatasetMb() * 1024 * 1024) throw new StatsError(`Datasets can be up to ${maxDatasetMb()} MB.`);
}

/** `gz` is the file gzip-compressed (smaller to store and to move; the engine unpacks it). */
export async function createSession(db: DB, ownerId: string, file: { name: string; size: number; gz: Buffer }) {
  checkUpload(file.name, file.size);
  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Dataset";
  const [ds] = await db.insert(statDatasets).values({ ownerId, name, fileName: file.name, size: file.size, data: file.gz }).returning({ id: statDatasets.id });
  let o: Overview;
  try {
    o = await engine<Overview>("/load", { datasetId: ds.id, history: [] });
  } catch (err) {
    await db.delete(statDatasets).where(eq(statDatasets.id, ds.id));
    throw err;
  }
  const [s] = await db
    .insert(statSessions)
    .values({ ownerId, datasetId: ds.id, title: name, nObs: o.nObs, nVars: o.nVars, variables: o.variables })
    .returning({ id: statSessions.id });
  if (o.importNotes?.length) {
    // What converting a CSV/Excel file to Stata format changed, shown at the top of the session.
    await db.insert(statRuns).values({ sessionId: s.id, input: "Converted to Stata format", mode: "NOTE", status: "IMPORT", explanation: o.importNotes.join("\n") });
  }
  return s.id;
}

export const SAMPLE_FILE = "ghana_households_simulated.dta";

export async function createSampleSession(db: DB, ownerId: string) {
  const bytes = await readFile(path.join(process.cwd(), "stats", "sample", SAMPLE_FILE));
  return createSession(db, ownerId, { name: SAMPLE_FILE, size: bytes.length, gz: gzipSync(bytes) });
}

export async function listSessions(db: DB, ownerId: string) {
  return db
    .select({ id: statSessions.id, title: statSessions.title, nObs: statSessions.nObs, nVars: statSessions.nVars, updatedAt: statSessions.updatedAt, fileName: statDatasets.fileName })
    .from(statSessions)
    .innerJoin(statDatasets, eq(statDatasets.id, statSessions.datasetId))
    .where(eq(statSessions.ownerId, ownerId))
    .orderBy(desc(statSessions.updatedAt));
}

export async function getSession(db: DB, ownerId: string, id: string) {
  const [s] = await db
    .select({ id: statSessions.id, title: statSessions.title, datasetId: statSessions.datasetId, history: statSessions.history, nObs: statSessions.nObs, nVars: statSessions.nVars, variables: statSessions.variables, lastEstimation: statSessions.lastEstimation, lastMargins: statSessions.lastMargins, fileName: statDatasets.fileName, createdAt: statSessions.createdAt })
    .from(statSessions)
    .innerJoin(statDatasets, eq(statDatasets.id, statSessions.datasetId))
    .where(and(eq(statSessions.id, id), eq(statSessions.ownerId, ownerId)));
  if (!s) return null;
  return { ...s, variables: s.variables as VarMeta[] };
}
export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export async function listRuns(db: DB, sessionId: string) {
  const rows = await db.select().from(statRuns).where(eq(statRuns.sessionId, sessionId)).orderBy(asc(statRuns.createdAt));
  return rows.map((r) => ({ ...r, results: (r.results as CommandResult[] | null) ?? [] }));
}
export type Run = Awaited<ReturnType<typeof listRuns>>[number];

async function mustSession(db: DB, ownerId: string, id: string) {
  const s = await getSession(db, ownerId, id);
  if (!s) throw new StatsError("Session not found.");
  return s;
}

async function mustRun(db: DB, ownerId: string, runId: string) {
  const [r] = await db.select().from(statRuns).where(eq(statRuns.id, runId));
  if (!r) throw new StatsError("Run not found.");
  const s = await mustSession(db, ownerId, r.sessionId);
  return { run: r, session: s };
}

// ───────── running ─────────

/** Stata typed by the user runs at once; English becomes a plan the user confirms. */
export async function submit(db: DB, ownerId: string, sessionId: string, input: string, mode: "auto" | "stata" | "english" = "auto") {
  const text = input.trim();
  if (!text) throw new StatsError("Type a request or a command.");
  if (text.length > 4000) throw new StatsError("That is too long. Split it into smaller requests.");
  const session = await mustSession(db, ownerId, sessionId);
  const isStata = mode === "stata" || (mode === "auto" && looksLikeStata(text));
  if (isStata) {
    const commands = splitCommands(text);
    if (commands.length > 40) throw new StatsError("Run at most 40 commands at a time.");
    const [r] = await db.insert(statRuns).values({ sessionId, input: text, mode: "STATA", commands, status: "PLAN" }).returning({ id: statRuns.id });
    await execute(db, session, r.id, commands, text, false);
    return r.id;
  }
  const recent = (await listRuns(db, sessionId)).filter((r) => r.status === "DONE").slice(-6).flatMap((r) => r.commands);
  let plan;
  try {
    plan = await translate(text, { vars: session.variables, nObs: session.nObs, history: session.history, recent });
  } catch (err) {
    if (err instanceof AiUnavailable) throw new StatsError(err.message);
    throw err;
  }
  const status = plan.commands.length ? "PLAN" : "CLARIFY";
  const [r] = await db
    .insert(statRuns)
    .values({ sessionId, input: text, mode: "ENGLISH", commands: plan.commands, status, explanation: plan.clarification && !plan.commands.length ? plan.clarification : plan.explanation })
    .returning({ id: statRuns.id });
  await touch(db, sessionId);
  return r.id;
}

/** Runs a confirmed plan; the user may have edited the commands. */
export async function confirm(db: DB, ownerId: string, runId: string, edited?: string) {
  const { run, session } = await mustRun(db, ownerId, runId);
  if (run.status !== "PLAN") throw new StatsError("This plan has already been handled.");
  const commands = edited !== undefined ? splitCommands(edited) : run.commands;
  if (!commands.length) throw new StatsError("There is nothing to run.");
  await execute(db, session, runId, commands, run.input, true);
}

export async function cancel(db: DB, ownerId: string, runId: string) {
  const { run } = await mustRun(db, ownerId, runId);
  if (run.status === "PLAN" || run.status === "CLARIFY") await db.update(statRuns).set({ status: "CANCELLED" }).where(eq(statRuns.id, runId));
}

async function execute(db: DB, session: Session, runId: string, commands: string[], input: string, explain: boolean) {
  let out: { results: CommandResult[]; changed: boolean; dataset?: Overview; kept?: string[]; lastEstimation?: string | null; lastMargins?: string };
  try {
    out = await engine("/run", { datasetId: session.datasetId, history: session.history, commands, lastEstimation: session.lastEstimation, lastMargins: session.lastMargins });
  } catch (err) {
    await db.update(statRuns).set({ status: "ERROR", commands, results: [{ command: commands[0], ok: false, error: err instanceof Error ? err.message : "failed" }] }).where(eq(statRuns.id, runId));
    throw err;
  }
  const ok = out.results.every((r) => r.ok);
  await db.update(statRuns).set({ status: ok ? "DONE" : "ERROR", commands, results: out.results }).where(eq(statRuns.id, runId));
  // The model and margins carry over to later requests (predict, estat, margins, marginsplot).
  const memory = { ...(out.lastEstimation ? { lastEstimation: out.lastEstimation } : {}), ...(out.lastMargins ? { lastMargins: out.lastMargins } : {}) };
  if (out.changed && out.dataset) {
    const kept = out.kept ?? out.results.filter((r) => r.ok && r.changesData).map((r) => r.command);
    await db
      .update(statSessions)
      .set({ history: [...session.history, ...kept], nObs: out.dataset.nObs, nVars: out.dataset.nVars, variables: out.dataset.variables, ...memory })
      .where(eq(statSessions.id, session.id));
  } else if (Object.keys(memory).length) {
    await db.update(statSessions).set(memory).where(eq(statSessions.id, session.id));
  } else {
    await touch(db, session.id);
  }
  if (explain && ok) await explainRun(db, runId, input, out.results).catch(() => null);
}

async function explainRun(db: DB, runId: string, input: string, results: CommandResult[]) {
  const analyses = results.filter((r) => r.ok && r.tables?.length && !r.changesData);
  if (!analyses.length) return;
  const text = await interpret(input, analyses);
  if (text) await db.update(statRuns).set({ interpretation: text }).where(eq(statRuns.id, runId));
}

export async function interpretRun(db: DB, ownerId: string, runId: string) {
  const { run } = await mustRun(db, ownerId, runId);
  if (run.status !== "DONE") throw new StatsError("Only finished analyses can be explained.");
  try {
    await explainRun(db, runId, run.input, (run.results as CommandResult[]) ?? []);
  } catch (err) {
    if (err instanceof AiUnavailable) throw new StatsError(err.message);
    throw err;
  }
}

/** Back to the data as uploaded (the run log stays). */
export async function resetData(db: DB, ownerId: string, sessionId: string) {
  const s = await mustSession(db, ownerId, sessionId);
  const o = await engine<Overview>("/load", { datasetId: s.datasetId, history: [] });
  await db.update(statSessions).set({ history: [], nObs: o.nObs, nVars: o.nVars, variables: o.variables, lastEstimation: null, lastMargins: null }).where(eq(statSessions.id, sessionId));
  await db.insert(statRuns).values({ sessionId, input: "Restored the original data", mode: "STATA", status: "RESET" });
}

export async function renameSession(db: DB, ownerId: string, sessionId: string, title: string) {
  const t = title.trim().slice(0, 80);
  if (!t) throw new StatsError("Give the session a name.");
  await mustSession(db, ownerId, sessionId);
  await db.update(statSessions).set({ title: t }).where(eq(statSessions.id, sessionId));
}

export async function deleteSession(db: DB, ownerId: string, sessionId: string) {
  const s = await mustSession(db, ownerId, sessionId);
  await db.delete(statDatasets).where(eq(statDatasets.id, s.datasetId)); // cascades to the session and runs
}

async function touch(db: DB, sessionId: string) {
  await db.update(statSessions).set({ updatedAt: new Date() }).where(eq(statSessions.id, sessionId));
}

// ───────── outputs ─────────

/** A do-file that reproduces the session in Stata itself. */
export function doFile(session: Session, runs: Run[]) {
  const lines = [
    `* ${session.title}`,
    `* The True Scholars Statistics Assistant — do-file generated ${new Date().toISOString().slice(0, 10)}`,
    `* Runs in Stata 14 or later. Put ${session.fileName} in your working directory first.`,
    "",
    "version 14",
    "clear all",
    "set more off",
    "",
  ];
  const ext = session.fileName.split(".").pop()?.toLowerCase();
  let useLine = "";
  const stem = session.fileName.replace(/\.[^.]+$/, "").replace(/"/g, "");
  if (ext === "dta") {
    useLine = `use "${session.fileName.replace(/"/g, "")}", clear`;
  } else {
    // Stata's own importers name variables differently from ours, so start from the exact original as .dta.
    lines.splice(2, 1, `* Runs in Stata 14 or later. First download "Original data (.dta)" from the Export menu`, `* and save it as ${stem}_original.dta in your working directory.`);
    useLine = `use "${stem}_original.dta", clear`;
  }
  lines.push(useLine, "");
  for (const r of runs) {
    if (r.status === "RESET") {
      lines.push("* Restored the original data", useLine, "");
      continue;
    }
    if (r.status !== "DONE" && r.status !== "ERROR") continue;
    const okCommands = r.results.filter((x) => x.ok).map((x) => x.command);
    if (!okCommands.length) continue;
    lines.push(r.mode === "ENGLISH" ? `* ${r.input.replace(/\n/g, " ")}` : "*" + "-".repeat(40));
    lines.push(...okCommands, "");
  }
  return lines.join("\n");
}

export function imagesFor(runs: Run[]) {
  return runs.flatMap((r) => r.results.filter((x) => x.ok).flatMap((x) => x.images ?? []));
}

export function tablesFor(runs: Run[]) {
  return runs.flatMap((r) => r.results.filter((x) => x.ok).flatMap((x) => x.tables ?? []));
}
