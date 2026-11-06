import type { Metadata } from "next";
import Link from "next/link";
import { toggleStarAction } from "@/app/actions/orderRoom";
import { ChatThread } from "@/components/ChatThread";
import { Icon } from "@/components/Icons";
import { LivePulse, MessageComposer } from "@/components/OrderRoomForms";
import { getDb } from "@/db";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS } from "@/lib/status";
import { fileMeta } from "@/server/files";
import { requireUser } from "@/server/guards";
import { markOrderNotificationsRead } from "@/server/notifications";
import { inboxPulse, listConversations, listMessages, markThreadRead } from "@/server/orderRoom";
import { getOrderForUser } from "@/server/orders";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

type Filter = "all" | "unread" | "starred";

function when(d: Date) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const initials = (name: string) => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  return (
    <span className="grid flex-none place-items-center rounded-full bg-green font-display font-bold text-amber" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function href(p: { c?: string; f?: Filter; q?: string }) {
  const sp = new URLSearchParams();
  if (p.c) sp.set("c", p.c);
  if (p.f && p.f !== "all") sp.set("f", p.f);
  if (p.q) sp.set("q", p.q);
  const s = sp.toString();
  return s ? `/messages?${s}` : "/messages";
}

export default async function Messages({ searchParams }: { searchParams: Promise<{ c?: string; f?: string; q?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter: Filter = sp.f === "unread" || sp.f === "starred" ? sp.f : "all";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const db = getDb();

  // Open conversation (only if this user is in it)
  const open = sp.c ? await getOrderForUser(db, sp.c, user.id).catch(() => null) : null;
  const selected = open && open.role !== "admin" ? open : null;
  if (selected) await Promise.all([markThreadRead(db, selected.order.id, user.id), markOrderNotificationsRead(db, user.id, selected.order.id)]);

  const [all, pulse, msgs] = await Promise.all([
    listConversations(db, user.id),
    inboxPulse(db, user.id),
    selected ? listMessages(db, selected.order.id) : Promise.resolve([]),
  ]);
  const meta = new Map((await fileMeta(db, msgs.flatMap((m) => m.files))).map((f) => [f.id, f]));

  const unreadCount = all.filter((c) => c.unread > 0).length;
  const starredCount = all.filter((c) => c.starred).length;
  const needle = q.toLowerCase();
  const convos = all
    .filter((c) => (filter === "unread" ? c.unread > 0 : filter === "starred" ? c.starred : true))
    .filter((c) => !needle || c.otherName.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle) || (c.last?.body ?? "").toLowerCase().includes(needle));
  const current = selected ? all.find((c) => c.orderId === selected.order.id) : undefined;
  const other = selected ? (selected.role === "client" ? selected.expert : selected.client) : null;
  const otherName = other?.name ?? "Unknown";
  const status = selected ? ORDER_STATUS[selected.order.status] : null;
  const nextDue = selected?.milestones.find((m) => (m.status === "FUNDED" || m.status === "REVISION_REQUESTED") && m.dueAt)?.dueAt;

  const chip = (f: Filter, label: React.ReactNode) => (
    <Link
      href={href({ c: selected?.order.id, f, q })}
      aria-current={filter === f ? "true" : undefined}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-bold no-underline ${filter === f ? "border-green bg-green text-white" : "border-line bg-white text-ink hover:border-green"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="chat-shell mx-auto flex h-full max-w-7xl bg-white md:border-x md:border-line">
      <LivePulse url="/api/inbox/pulse" initial={pulse} />

      {/* ── Conversation list ── */}
      <aside className={`${selected ? "hidden md:flex" : "flex"} w-full flex-none flex-col border-line md:w-80 md:border-r lg:w-96`} aria-label="Conversations">
        <div className="flex flex-col gap-3 border-b border-line p-4">
          <h1 className="text-2xl font-bold">Conversations</h1>
          <form action="/messages" className="relative">
            {selected && <input type="hidden" name="c" value={selected.order.id} />}
            {filter !== "all" && <input type="hidden" name="f" value={filter} />}
            <label htmlFor="q" className="sr-only">Search conversations</label>
            <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-muted" />
            <input id="q" name="q" defaultValue={q} placeholder="Search by name or order" className="field !pl-10" />
          </form>
          <div className="flex flex-wrap gap-2">
            {chip("all", "All")}
            {chip("unread", <>Unread{unreadCount > 0 && <span className="rounded-full bg-amber px-1.5 text-xs text-ink">{unreadCount}</span>}</>)}
            {chip("starred", <><Icon name="star" size={15} /> Starred{starredCount > 0 ? ` ${starredCount}` : ""}</>)}
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto">
          {convos.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-6 py-16 text-center text-ink-muted">
              <Icon name={filter === "starred" ? "star" : "message"} size={28} />
              <span className="font-bold text-ink">
                {q ? "No matches" : filter === "unread" ? "You're all caught up" : filter === "starred" ? "No starred conversations" : "No conversations yet"}
              </span>
              <span className="text-sm">
                {q ? "Try another name or order." : filter === "starred" ? "Star a conversation to keep it here." : filter === "unread" ? "New messages will show up here." : "Each order comes with its own chat."}
              </span>
            </li>
          )}
          {convos.map((c) => {
            const active = c.orderId === selected?.order.id;
            return (
              <li key={c.orderId}>
                <Link
                  href={href({ c: c.orderId, f: filter, q })}
                  aria-current={active ? "true" : undefined}
                  className={`flex items-center gap-3 border-l-4 px-4 py-3.5 text-ink no-underline ${active ? "border-amber bg-green-tint" : "border-transparent hover:bg-parchment"}`}
                >
                  <Avatar name={c.otherName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate ${c.unread ? "font-bold" : "font-medium"}`}>{c.otherName}</span>
                      <span className={`flex-none text-xs ${c.unread ? "font-bold text-green" : "text-ink-muted"}`}>{c.last ? when(c.last.at) : ""}</span>
                    </div>
                    <div className="flex items-center gap-1 truncate text-xs text-ink-muted">
                      {c.starred && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="flex-none text-amber" aria-label="Starred"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></svg>
                      )}
                      {c.role === "buying" ? "Buying" : "Selling"} · {c.title}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`flex-1 truncate text-sm ${c.unread ? "font-medium text-ink" : "text-ink-muted"}`}>
                        {c.last ? `${c.last.mine ? "You: " : ""}${c.last.body}` : "No messages yet. Say hello."}
                      </span>
                      {c.unread > 0 && <span className="grid min-w-5 flex-none place-items-center rounded-full bg-amber px-1.5 text-xs font-bold text-ink">{c.unread}</span>}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ── Open conversation ── */}
      {selected && other ? (
        <section className="flex min-w-0 flex-1 flex-col" aria-label={`Conversation with ${otherName}`}>
          <header className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-5">
            <Link href={href({ f: filter, q })} className="grid size-10 flex-none place-items-center rounded-full text-ink hover:bg-parchment md:hidden" aria-label="Back to conversations">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
            </Link>
            <Avatar name={otherName} size={42} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{otherName}</div>
              <div className="truncate text-xs text-ink-muted">{selected.role === "client" ? "Expert" : "Client"} · {selected.order.title}</div>
            </div>
            <form action={toggleStarAction}>
              <input type="hidden" name="orderId" value={selected.order.id} />
              <input type="hidden" name="starred" value={current?.starred ? "0" : "1"} />
              <button
                className={`grid size-10 place-items-center rounded-full hover:bg-parchment ${current?.starred ? "text-amber-deep" : "text-ink-muted"}`}
                aria-label={current?.starred ? "Unstar conversation" : "Star conversation"}
                aria-pressed={current?.starred ? "true" : "false"}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill={current?.starred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />
                </svg>
              </button>
            </form>
            <Link href={`/orders/${selected.order.id}`} className="hidden rounded-full border border-line px-4 py-2 text-sm font-bold text-green no-underline hover:border-green sm:inline-flex xl:hidden">
              View order
            </Link>
          </header>

          <ChatThread msgs={msgs} meta={meta} viewerId={user.id} className="flex-1 bg-white px-4 py-4 sm:px-6" empty={`No messages yet. Say hello to ${otherName.split(" ")[0]}.`} />

          <div className="border-t border-line bg-parchment/50 px-4 py-3 sm:px-6">
            {selected.order.status !== "CANCELLED" ? <MessageComposer orderId={selected.order.id} rows={2} /> : <p className="text-sm text-ink-muted">This order was cancelled, so the conversation is closed.</p>}
          </div>
        </section>
      ) : (
        <section className="hidden flex-1 flex-col items-center justify-center gap-5 bg-parchment/40 px-8 text-center md:flex">
          <div className="relative" aria-hidden="true">
            <span className="grid size-24 place-items-center rounded-full bg-green text-amber shadow-lg">
              <Icon name="message" size={40} />
            </span>
            <span className="absolute -top-2 -right-6 flex gap-1 rounded-full border border-line bg-white px-3 py-2 shadow">
              <span className="size-1.5 animate-pulse rounded-full bg-green" />
              <span className="size-1.5 animate-pulse rounded-full bg-green [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-green [animation-delay:300ms]" />
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-bold">{all.length ? "Pick a conversation" : "Your conversations will appear here"}</h2>
            <p className="max-w-sm text-ink-muted">
              {all.length ? "Choose someone on the left to read and reply. New messages arrive within seconds." : "Every order comes with its own chat, so you can talk with your expert or client in one safe place."}
            </p>
          </div>
          {!all.length && <Link href="/services" className="btn-primary">Find an expert</Link>}
        </section>
      )}

      {/* ── Order details (wide screens) ── */}
      {selected && status && (
        <aside className="hidden w-72 flex-none flex-col gap-5 overflow-y-auto border-l border-line bg-parchment/40 p-5 xl:flex" aria-label="Order details">
          <div className="flex flex-col items-center gap-2 text-center">
            <Avatar name={otherName} size={64} />
            <div className="font-bold">{otherName}</div>
            <div className="text-xs text-ink-muted">{selected.role === "client" ? "Your expert" : "Your client"}</div>
          </div>
          <div className="flex flex-col gap-3 rounded-md border border-line bg-white p-4 text-sm">
            <div className="eyebrow">Order</div>
            <div className="font-bold">{selected.order.title}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
              <dt className="text-ink-muted">Status</dt>
              <dd className="text-right"><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${status.tone}`}>{status.label}</span></dd>
              <dt className="text-ink-muted">Total</dt>
              <dd className="text-right font-bold">{formatMoney(selected.order.totalMinor, selected.order.currency)}</dd>
              {nextDue && (
                <>
                  <dt className="text-ink-muted">Due</dt>
                  <dd className="text-right">{nextDue.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</dd>
                </>
              )}
            </dl>
            <Link href={`/orders/${selected.order.id}`} className="btn-primary mt-1 justify-center">Open order</Link>
          </div>
          <p className="flex gap-2 text-xs text-ink-muted">
            <span className="text-green"><Icon name="shield" size={16} /></span>
            Keep messages and payment on The True Scholars. It&apos;s what protects you if something goes wrong.
          </p>
        </aside>
      )}
    </div>
  );
}
