"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { markAllRead } from "@/server/notifications";

export async function markAllReadAction() {
  const user = await requireUser();
  await markAllRead(getDb(), user.id);
  revalidatePath("/", "layout");
}
