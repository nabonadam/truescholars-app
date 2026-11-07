"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { endToolAccess, grantToolAccess } from "@/server/toolAccess";

type GrantState = { ok?: string; error?: string } | undefined;

export async function litGrantAction(_p: GrantState, form: FormData): Promise<GrantState> {
  await requireUser("ADMIN");
  try {
    const r = await grantToolAccess(getDb(), "lit", String(form.get("email") ?? ""), Number(form.get("days")), String(form.get("note") ?? ""));
    revalidatePath("/admin/lit");
    return { ok: `${r.name ?? "They"} now has Literature Review access until ${r.until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not grant access." };
  }
}

export async function litEndAccessAction(userId: string) {
  await requireUser("ADMIN");
  await endToolAccess(getDb(), "lit", userId);
  revalidatePath("/admin/lit");
}
