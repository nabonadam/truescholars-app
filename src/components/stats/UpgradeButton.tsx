"use client";

import { useActionState } from "react";
import { upgradeRequestAction } from "@/app/actions/stats";
import { Icon } from "../Icons";

export function UpgradeButton({ requested }: { requested: boolean }) {
  const [state, action, pending] = useActionState(upgradeRequestAction, undefined);
  if (requested || state?.ok) {
    return (
      <div className="flex items-start gap-3 rounded-sm bg-green-tint p-4 text-green">
        <Icon name="check" size={20} className="mt-0.5 flex-none" />
        <p className="text-[15px]"><b>Request sent.</b> We&apos;ll switch your access on and send payment details to your email, usually within a day.</p>
      </div>
    );
  }
  return (
    <form action={action}>
      <button disabled={pending} className="btn-amber w-full sm:w-auto">{pending ? "Sending…" : "Request upgrade"}</button>
    </form>
  );
}
