"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { endAccess, grantAccess } from "@/server/statsAccess";

export type GrantState = { error?: string; ok?: string } | undefined;

export async function grantAction(_p: GrantState, form: FormData): Promise<GrantState> {
  await requireUser("ADMIN");
  try {
    const r = await grantAccess(getDb(), String(form.get("email") ?? ""), Number(form.get("days")), String(form.get("note") ?? ""));
    revalidatePath("/admin/stats");
    return { ok: `${r.name ?? "They"} now has access until ${r.until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not grant access." };
  }
}

export async function endAccessAction(userId: string) {
  await requireUser("ADMIN");
  await endAccess(getDb(), userId);
  revalidatePath("/admin/stats");
}
