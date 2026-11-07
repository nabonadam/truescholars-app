"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { endToolAccess, grantToolAccess } from "@/server/toolAccess";

type GrantState = { ok?: string; error?: string } | undefined;

export async function qualGrantAction(_p: GrantState, form: FormData): Promise<GrantState> {
  await requireUser("ADMIN");
  try {
    const r = await grantToolAccess(getDb(), "qual", String(form.get("email") ?? ""), Number(form.get("days")), String(form.get("note") ?? ""));
    revalidatePath("/admin/qual");
    return { ok: `${r.name ?? "They"} now has Qualitative Studio access until ${r.until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not grant access." };
  }
}

export async function qualEndAccessAction(userId: string) {
  await requireUser("ADMIN");
  await endToolAccess(getDb(), "qual", userId);
  revalidatePath("/admin/qual");
}
