"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { toMinor } from "@/lib/money";
import { requireUser } from "@/server/guards";
import { saveService, ServiceError, setServiceStatus, type TierInput, type TierName } from "@/server/services";

export type FormState = { error?: string } | undefined;

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

const baseSchema = z.object({
  title: z.string().trim().min(12, "Make the title a little more descriptive (12+ characters)").max(90),
  categoryId: z.string().min(1, "Choose a category"),
  description: z.string().trim().min(120, "Describe the service in more detail (120+ characters)").max(4000),
});

function readTier(form: FormData, name: TierName): TierInput | null {
  const price = String(form.get(`${name}_price`) ?? "").trim();
  if (!price) return null;
  return {
    name,
    priceMinor: toMinor(Number(price)),
    deliveryDays: Number(form.get(`${name}_days`)),
    revisions: Number(form.get(`${name}_revisions`)),
    includes: lines(form.get(`${name}_includes`)).slice(0, 8),
  };
}

export async function saveServiceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("EXPERT");
  const parsed = baseSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form" };
  if (form.get("integrity") !== "on") return { error: "Please confirm the service follows our academic integrity policy." };

  const tiers = (["BASIC", "STANDARD", "PRO"] as const).map((n) => readTier(form, n)).filter((t): t is TierInput => t !== null);
  const serviceId = String(form.get("serviceId") ?? "") || undefined;
  let id: string;
  try {
    id = await saveService(getDb(), user.id, { ...parsed.data, requirements: lines(form.get("requirements")).slice(0, 6), tiers }, serviceId);
  } catch (err) {
    if (err instanceof ServiceError) return { error: err.message };
    throw err;
  }
  revalidatePath("/expert/services");
  revalidatePath("/services");
  redirect(`/services/${id}?saved=1`);
}

export async function toggleServiceAction(form: FormData) {
  const user = await requireUser("EXPERT");
  const status = form.get("status") === "PAUSED" ? "PAUSED" : "ACTIVE";
  await setServiceStatus(getDb(), user.id, String(form.get("serviceId")), status);
  revalidatePath("/expert/services");
  revalidatePath("/services");
}
