"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { ReviewError, setReviewHidden } from "@/server/reviews";

export type ReviewAdminState = { error?: string; ok?: number } | undefined;

export async function hideReviewAction(_prev: ReviewAdminState, form: FormData): Promise<ReviewAdminState> {
  await requireUser("ADMIN");
  try {
    await setReviewHidden(getDb(), { reviewId: String(form.get("reviewId")), hidden: form.get("hidden") === "1", reason: String(form.get("reason") ?? "") });
  } catch (err) {
    if (err instanceof ReviewError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/reviews");
  return { ok: Date.now() };
}
