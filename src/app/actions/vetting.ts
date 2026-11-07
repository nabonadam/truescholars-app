"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { approveApplication, EXPERT_FIELDS, QUALIFICATIONS, rejectApplication, submitApplication, VettingError } from "@/server/vetting";

export type FormState = { error?: string } | undefined;

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => v || null)
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), "Links must start with http:// or https://");

const applicationSchema = z.object({
  qualification: z.enum(QUALIFICATIONS, { message: "Choose your highest qualification" }),
  fields: z.array(z.enum(EXPERT_FIELDS)).min(1, "Choose at least one field").max(4, "Choose up to four fields"),
  experienceYears: z.coerce.number().int().min(0).max(60),
  pitch: z.string().trim().min(80, "Tell us a bit more (at least 80 characters)").max(1500),
  cvUrl: optionalUrl,
  sampleUrl: optionalUrl,
  litRetriever: z.boolean(),
});

export async function submitApplicationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = applicationSchema.safeParse({
    qualification: form.get("qualification"),
    fields: form.getAll("fields"),
    experienceYears: form.get("experienceYears"),
    pitch: form.get("pitch"),
    cvUrl: form.get("cvUrl") ?? "",
    sampleUrl: form.get("sampleUrl") ?? "",
    litRetriever: form.get("litRetriever") === "1",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form" };
  if (!parsed.data.cvUrl) return { error: "Please add a link to your CV." };

  try {
    await submitApplication(getDb(), user.id, parsed.data);
  } catch (err) {
    if (err instanceof VettingError) return { error: err.message };
    throw err;
  }
  revalidatePath("/apply");
  redirect("/apply?submitted=1");
}

export async function approveAction(form: FormData) {
  await requireUser("ADMIN");
  const id = String(form.get("applicationId"));
  await approveApplication(getDb(), { applicationId: id, note: String(form.get("note") ?? "") });
  revalidatePath("/admin/applications");
  redirect(`/admin/applications/${id}?done=approved`);
}

export async function rejectAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireUser("ADMIN");
  const id = String(form.get("applicationId"));
  try {
    await rejectApplication(getDb(), { applicationId: id, note: String(form.get("note") ?? "") });
  } catch (err) {
    if (err instanceof VettingError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/applications");
  redirect(`/admin/applications/${id}?done=rejected`);
}
