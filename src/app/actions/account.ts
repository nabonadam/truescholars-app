"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { AccountError, changePassword, removeAvatar, setAvatar, setEmailNotifications, updateExpertProfile, updateProfile } from "@/server/account";
import { requireUser } from "@/server/guards";

export type AccountState = { error?: string; ok?: number; image?: string | null } | undefined;

const known = (err: unknown): AccountState => {
  if (err instanceof AccountError) return { error: err.message };
  throw err;
};
const refresh = () => revalidatePath("/", "layout"); // name and photo appear across the app

export async function profileAction(_p: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireUser();
  try {
    await updateProfile(getDb(), user.id, { name: String(form.get("name") ?? ""), country: String(form.get("country") ?? "") });
  } catch (err) {
    return known(err);
  }
  refresh();
  return { ok: Date.now() };
}

export async function avatarAction(_p: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireUser();
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo first." };
  try {
    const image = await setAvatar(getDb(), user.id, { type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    refresh();
    return { ok: Date.now(), image };
  } catch (err) {
    return known(err);
  }
}

export async function removeAvatarAction(): Promise<AccountState> {
  const user = await requireUser();
  await removeAvatar(getDb(), user.id);
  refresh();
  return { ok: Date.now(), image: null };
}

export async function passwordAction(_p: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireUser();
  const next = String(form.get("next") ?? "");
  try {
    await changePassword(getDb(), user.id, { current: String(form.get("current") ?? ""), next, confirm: String(form.get("confirm") ?? "") });
  } catch (err) {
    return known(err);
  }
  // Every session from before the change has ended, this one included: log in again with the new password.
  redirect("/sign-in?changed=1");
}

export async function emailPrefAction(form: FormData) {
  const user = await requireUser();
  await setEmailNotifications(getDb(), user.id, form.get("on") === "1");
  revalidatePath("/settings");
}

export async function expertProfileAction(_p: AccountState, form: FormData): Promise<AccountState> {
  const user = await requireUser("EXPERT");
  try {
    await updateExpertProfile(getDb(), user.id, {
      headline: String(form.get("headline") ?? ""),
      bio: String(form.get("bio") ?? ""),
      skills: String(form.get("skills") ?? "").split(","),
      litRetriever: form.get("litRetriever") === "1",
    });
  } catch (err) {
    return known(err);
  }
  refresh();
  return { ok: Date.now() };
}
