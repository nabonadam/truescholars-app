import type { Metadata } from "next";
import { markAllReadAction } from "@/app/actions/notifications";
import { KindIcon } from "@/components/Icons";
import { getDb } from "@/db";
import { requireUser } from "@/server/guards";
import { listNotifications } from "@/server/notifications";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

function ago(d: Date) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function Notifications() {
  const user = await requireUser();
  const rows = await listNotifications(getDb(), user.id);
  const unread = rows.filter((n) => !n.readAt).length;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">Notifications</span>
          <h1 className="text-3xl font-bold">What&apos;s new</h1>
        </div>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <button className="btn-outline border border-line">Mark all as read</button>
          </form>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card text-ink-muted">You&apos;re all caught up. Updates about your orders and messages will appear here.</div>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-md border border-line bg-white">
          {rows.map((n) => (
            <li key={n.id} className="border-b border-line last:border-0">
              <a href={`/notifications/${n.id}`} className={`flex gap-4 px-5 py-4 text-ink no-underline hover:bg-parchment ${n.readAt ? "" : "bg-green-tint/50"}`}>
                <KindIcon kind={n.kind} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <span className={`${n.readAt ? "font-medium" : "font-bold"}`}>{n.title}</span>
                    <span className="flex-none text-xs text-ink-muted">{ago(n.createdAt)}</span>
                  </div>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{n.body}</p>}
                </div>
                {!n.readAt && <span className="mt-2 size-2.5 flex-none rounded-full bg-amber" aria-label="Unread" />}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
