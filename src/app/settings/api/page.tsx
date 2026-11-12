import type { Metadata } from "next";
import Link from "next/link";
import { ApiKeys, Webhooks } from "@/components/ApiSettings";
import { getDb } from "@/db";
import { apiAccessFor, listApiKeys } from "@/server/apiAccess";
import { requireUser } from "@/server/guards";
import { listStudies } from "@/server/qual";
import { usageStatus } from "@/server/usage";
import { EVENTS, listWebhooks, webhookView } from "@/server/webhooks";

export const metadata: Metadata = { title: "Developer API" };
export const dynamic = "force-dynamic";

export default async function ApiSettingsPage() {
  const user = await requireUser();
  const db = getDb();
  const [access, keys, hooks, studies, usage] = await Promise.all([apiAccessFor(db, user), listApiKeys(db, user.id), listWebhooks(db, user.id), listStudies(db, user.id), usageStatus(db, user, "qual")]);
  const minutes = usage.unlimited ? null : usage.units.find((u) => u.kind === "qual.minutes");

  return (
    <>
      <section className="bg-green text-white">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <Link href="/settings" className="text-sm font-bold text-amber no-underline">← Account settings</Link>
          <h1 className="mt-1 text-3xl font-extrabold text-white">Developer API</h1>
          <p className="text-on-green-muted">Keys and webhooks for the Qualitative Studio API. <Link href="/developers" className="font-bold text-white">Read the documentation</Link>.</p>
        </div>
      </section>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <div className={`card flex flex-wrap items-center justify-between gap-3 ${access.active ? "" : "border-amber"}`}>
          <div>
            <h2 className="text-lg font-bold">{access.active ? "API plan active" : access.until ? "Your API plan has ended" : "You don't have the API plan yet"}</h2>
            <p className="text-sm text-ink-muted">
              {access.admin ? "Admins always have API access." : access.active ? `Until ${access.until!.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}.` : "Keys and webhooks need the Qualitative Studio API plan. Existing keys are paused, not deleted."}
              {minutes && access.active && ` Transcription this month: ${minutes.used.toLocaleString("en-GB")} of ${minutes.limit.toLocaleString("en-GB")} minutes.`}
            </p>
          </div>
          {!access.admin && <Link href="/developers" className={access.active ? "btn-outline" : "btn-amber"}>{access.active ? "Extend" : "See the plan"}</Link>}
        </div>

        <ApiKeys
          enabled={access.active}
          keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() }))}
        />
        <Webhooks enabled={access.active} hooks={hooks.map(webhookView)} studies={studies.map((s) => ({ id: s.id, title: s.title }))} events={Object.entries(EVENTS).map(([id, help]) => ({ id, help }))} />
      </div>
    </>
  );
}
