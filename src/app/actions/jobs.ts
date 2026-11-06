"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { toMinor } from "@/lib/money";
import { FileError } from "@/server/files";
import { requireUser } from "@/server/guards";
import { closeJob, declineProposal, hireProposal, JobError, postJob, setShortlisted, submitProposal, withdrawProposal } from "@/server/jobs";

export type JobFormState = { error?: string } | undefined;

const cedis = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? toMinor(n) : NaN;
};
const known = (err: unknown): JobFormState => {
  if (err instanceof JobError || err instanceof FileError) return { error: err.message };
  throw err;
};

export async function postJobAction(_prev: JobFormState, form: FormData): Promise<JobFormState> {
  const user = await requireUser();
  const timeline = String(form.get("timeline") ?? "");
  let id: string;
  try {
    const job = await postJob(
      getDb(),
      user.id,
      {
        title: String(form.get("title") ?? ""),
        categoryId: String(form.get("categoryId") ?? ""),
        description: String(form.get("description") ?? ""),
        skills: String(form.get("skills") ?? "").split(",").filter(Boolean),
        budgetMinMinor: cedis(form.get("budgetMin")),
        budgetMaxMinor: cedis(form.get("budgetMax")),
        timelineDays: timeline ? Number(timeline) : null,
        level: String(form.get("level") ?? "any"),
      },
      form.getAll("files").filter((v): v is File => v instanceof File && v.size > 0),
    );
    id = job.id;
  } catch (err) {
    return known(err);
  }
  revalidatePath("/jobs");
  redirect(`/jobs/${id}?posted=1`);
}

export async function proposalAction(_prev: JobFormState, form: FormData): Promise<JobFormState> {
  const user = await requireUser("EXPERT");
  const jobId = String(form.get("jobId"));
  try {
    const raw = JSON.parse(String(form.get("plan") ?? "[]")) as { title: string; amount: string; days: string }[];
    await submitProposal(getDb(), {
      jobId,
      expertUserId: user.id,
      pitch: String(form.get("pitch") ?? ""),
      milestonePlan: raw.map((m) => ({ title: String(m.title ?? ""), amountMinor: cedis(m.amount), dueInDays: Math.round(Number(m.days)) })),
    });
  } catch (err) {
    if (err instanceof SyntaxError) return { error: "Something went wrong reading your milestones. Please try again." };
    return known(err);
  }
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}?sent=1`);
}

export async function withdrawAction(form: FormData) {
  const user = await requireUser("EXPERT");
  await withdrawProposal(getDb(), String(form.get("proposalId")), user.id).catch(known);
  revalidatePath(`/jobs/${form.get("jobId")}`);
  revalidatePath("/proposals");
}

export async function shortlistAction(form: FormData) {
  const user = await requireUser();
  await setShortlisted(getDb(), String(form.get("proposalId")), user.id, form.get("on") === "1").catch(known);
  revalidatePath(`/jobs/${form.get("jobId")}`);
}

export async function declineAction(form: FormData) {
  const user = await requireUser();
  await declineProposal(getDb(), String(form.get("proposalId")), user.id).catch(known);
  revalidatePath(`/jobs/${form.get("jobId")}`);
}

export async function hireAction(_prev: JobFormState, form: FormData): Promise<JobFormState> {
  const user = await requireUser();
  let orderId: string;
  try {
    orderId = (await hireProposal(getDb(), { proposalId: String(form.get("proposalId")), clientId: user.id })).id;
  } catch (err) {
    return known(err);
  }
  revalidatePath("/jobs/mine");
  redirect(`/orders/${orderId}?hired=1`);
}

export async function closeJobAction(form: FormData) {
  const user = await requireUser();
  await closeJob(getDb(), String(form.get("jobId")), user.id).catch(known);
  revalidatePath(`/jobs/${form.get("jobId")}`);
  revalidatePath("/jobs/mine");
}
