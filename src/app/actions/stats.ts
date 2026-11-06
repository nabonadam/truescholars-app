"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { ENDED } from "@/lib/statsCopy";
import { accessFor, canRun } from "@/server/statsAccess";
import { StatsError, cancel, confirm, createSampleSession, deleteSession, interpretRun, renameSession, resetData, submit } from "@/server/stats";

/** Running analyses needs an active trial or access; viewing and downloading never does. */
async function runner() {
  const user = await requireUser();
  const access = await accessFor(getDb(), user);
  if (!canRun(access)) throw new StatsError(ENDED);
  return user;
}

export type StatsState = { error?: string; ok?: number; runId?: string } | undefined;

const known = (err: unknown): StatsState => {
  if (err instanceof StatsError) return { error: err.message };
  throw err;
};

export async function sampleAction(): Promise<StatsState> {
  let user;
  try {
    user = await runner();
  } catch (err) {
    return known(err);
  }
  let id: string;
  try {
    id = await createSampleSession(getDb(), user.id);
  } catch (err) {
    return known(err);
  }
  redirect(`/tools/stats/${id}`);
}

const page = (id: string) => revalidatePath(`/tools/stats/${id}`);

export async function submitAction(sessionId: string, input: string, mode: "auto" | "stata" | "english"): Promise<StatsState> {
  let user;
  try {
    user = await runner();
  } catch (err) {
    return known(err);
  }
  try {
    const runId = await submit(getDb(), user.id, sessionId, input, mode);
    page(sessionId);
    return { ok: Date.now(), runId };
  } catch (err) {
    page(sessionId);
    return known(err);
  }
}

export async function confirmAction(sessionId: string, runId: string, commands?: string): Promise<StatsState> {
  let user;
  try {
    user = await runner();
  } catch (err) {
    return known(err);
  }
  try {
    await confirm(getDb(), user.id, runId, commands);
    page(sessionId);
    return { ok: Date.now(), runId };
  } catch (err) {
    page(sessionId);
    return known(err);
  }
}

export async function cancelAction(sessionId: string, runId: string): Promise<StatsState> {
  const user = await requireUser();
  await cancel(getDb(), user.id, runId).catch(known);
  page(sessionId);
  return { ok: Date.now() };
}

export async function interpretAction(sessionId: string, runId: string): Promise<StatsState> {
  let user;
  try {
    user = await runner();
  } catch (err) {
    return known(err);
  }
  try {
    await interpretRun(getDb(), user.id, runId);
  } catch (err) {
    return known(err);
  }
  page(sessionId);
  return { ok: Date.now(), runId };
}

export async function resetAction(sessionId: string): Promise<StatsState> {
  let user;
  try {
    user = await runner();
  } catch (err) {
    return known(err);
  }
  try {
    await resetData(getDb(), user.id, sessionId);
  } catch (err) {
    return known(err);
  }
  page(sessionId);
  return { ok: Date.now() };
}

export async function renameAction(sessionId: string, title: string): Promise<StatsState> {
  const user = await requireUser();
  try {
    await renameSession(getDb(), user.id, sessionId, title);
  } catch (err) {
    return known(err);
  }
  page(sessionId);
  return { ok: Date.now() };
}

export async function deleteAction(sessionId: string) {
  const user = await requireUser();
  await deleteSession(getDb(), user.id, sessionId);
  revalidatePath("/tools/stats");
  redirect("/tools/stats");
}
