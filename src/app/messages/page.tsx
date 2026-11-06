import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { AutoRefresh } from "@/components/OrderRoomForms";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { listConversations } from "@/server/orderRoom";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

function when(d: Date) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function Messages() {
  const user = await requireUser();
  const convos = await listConversations(getDb(), user.id);
  const totalUnread = convos.reduce((s, c) => s + c.unread, 0);

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <AutoRefresh seconds={10} />
      <div className="flex flex-col gap-1">
        <span className="eyebrow">Inbox</span>
        <h1 className="text-3xl font-bold">Messages</h1>
        <p className="text-ink-muted">{totalUnread > 0 ? `${totalUnread} unread message${totalUnread === 1 ? "" : "s"}` : "All conversations, newest first."}</p>
      </div>

      {convos.length === 0 ? (
        <div className="card flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-sm bg-green-tint text-green"><Icon name="message" size={24} /></span>
          <p className="text-ink-muted">
            No conversations yet. Each order comes with its own chat.{" "}
            <Link href="/services" className="font-bold text-green">Find an expert</Link>
          </p>
        </div>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-md border border-line bg-white">
          {convos.map((c) => (
            <li key={c.orderId} className="border-b border-line last:border-0">
              <Link href={`/orders/${c.orderId}#messages`} className={`flex items-center gap-4 px-4 py-4 text-ink no-underline hover:bg-parchment sm:px-5 ${c.unread ? "bg-green-tint/40" : ""}`}>
                <span className="grid size-12 flex-none place-items-center rounded-full bg-green font-display font-bold text-amber" aria-hidden="true">
                  {c.otherName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={c.unread ? "font-bold" : "font-medium"}>{c.otherName}</span>
                    <span className={`flex-none text-xs ${c.unread ? "font-bold text-green" : "text-ink-muted"}`}>{c.last ? when(c.last.at) : ""}</span>
                  </div>
                  <div className="truncate text-xs text-ink-muted">{c.role === "buying" ? "Buying" : "Selling"} · {c.title}</div>
                  <div className={`truncate text-sm ${c.unread ? "font-medium text-ink" : "text-ink-muted"}`}>
                    {c.last ? `${c.last.mine ? "You: " : ""}${c.last.body}` : "No messages yet. Say hello."}
                  </div>
                </div>
                {c.unread > 0 && <span className="grid min-w-6 flex-none place-items-center rounded-full bg-amber px-1.5 text-xs font-bold text-ink">{c.unread}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
