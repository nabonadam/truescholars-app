import type { Metadata } from "next";
import Link from "next/link";
import { AdminTabs } from "@/components/AdminTabs";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { listFlaggedMessages } from "@/server/orderRoom";

export const metadata: Metadata = { title: "Flagged messages" };
export const dynamic = "force-dynamic";

export default async function FlaggedMessages() {
  await requireUser("ADMIN");
  const rows = await listFlaggedMessages(getDb());

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <span className="eyebrow">Admin</span>
        <h1 className="text-3xl font-bold">Flagged messages</h1>
        <p className="text-ink-muted">
          Messages that look like they share phone numbers, emails or WhatsApp links. Both people see a reminder to keep work on the platform.
          Open the order to read the conversation in context.
        </p>
      </div>
      <AdminTabs active="/admin/messages" />

      {rows.length === 0 ? (
        <div className="card text-ink-muted">Nothing flagged. Good.</div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((m) => (
            <li key={m.id} className="card flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <b>{m.senderName ?? m.senderEmail}</b> <span className="text-ink-muted">· {m.senderEmail}</span>
                </span>
                <span className="text-ink-muted">{m.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <p className="whitespace-pre-line rounded-sm bg-parchment px-4 py-3">{m.body}</p>
              {m.orderId && (
                <Link href={`/orders/${m.orderId}`} className="self-start text-sm font-bold text-green">
                  Open order: {m.orderTitle} →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
