"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPrefs, playBell, playMessage, playPop, unlockAudioOnGesture } from "@/lib/sounds";
import { Icon, type IconName } from "./Icons";

type Incoming = { id: string; at: string; sender: string; preview: string; orderId: string | null; title: string | null };
type Pulse = { messages: number; notifications: number; incoming: Incoming | null };
type Toast = Incoming & { key: number };

function Badge({ href, icon, label, n, bump }: { href: string; icon: IconName; label: string; n: number; bump: boolean }) {
  return (
    <Link href={href} aria-label={n > 0 ? `${label}, ${n} unread` : label} className="relative grid size-11 place-items-center rounded-full text-white hover:bg-white/10">
      <span className={bump ? "animate-[ts-wiggle_0.6s_ease-in-out]" : ""}>
        <Icon name={icon} size={22} />
      </span>
      {n > 0 && <span className="absolute top-1 right-1 grid min-w-5 place-items-center rounded-full bg-amber px-1 text-[11px] font-bold text-ink">{n > 9 ? "9+" : n}</span>}
    </Link>
  );
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

/**
 * Message and notification icons that stay current, plus everything that tells you a message
 * arrived: a sound, a pop-up with a reply link, the count in the tab title, and (if you allowed it)
 * a desktop alert when the tab is in the background.
 */
export function HeaderBadges({ messages, notifications }: { messages: number; notifications: number }) {
  const [c, setC] = useState({ messages, notifications });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bump, setBump] = useState<"messages" | "notifications" | null>(null);
  const path = usePathname();
  const router = useRouter();
  const lastIncoming = useRef<string | null | undefined>(undefined); // undefined until the first check
  const lastNotes = useRef<number | null>(null);

  useEffect(() => setC({ messages, notifications }), [messages, notifications]);
  useEffect(() => unlockAudioOnGesture(), []);

  const dismiss = useCallback((key: number) => setToasts((t) => t.filter((x) => x.key !== key)), []);

  const check = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox/pulse", { cache: "no-store" });
      if (!r.ok) return;
      const p = (await r.json()) as Pulse;
      setC({ messages: p.messages, notifications: p.notifications });

      const first = lastIncoming.current === undefined;
      const fresh = !first && p.incoming && p.incoming.id !== lastIncoming.current;
      if (fresh && p.incoming) {
        const inc = p.incoming;
        const q = new URLSearchParams(window.location.search);
        const viewing =
          document.visibilityState === "visible" &&
          inc.orderId !== null &&
          (window.location.pathname === `/orders/${inc.orderId}` || (window.location.pathname === "/messages" && q.get("c") === inc.orderId));
        if (viewing) {
          playPop();
        } else {
          playMessage();
          setBump("messages");
          setToasts((t) => [...t.slice(-2), { ...inc, key: Date.now() }]);
          if (document.visibilityState !== "visible" && getPrefs().desktop && typeof Notification !== "undefined" && Notification.permission === "granted") {
            const n = new Notification(`${inc.sender} · The True Scholars`, { body: inc.preview || "Sent you a message", tag: `msg-${inc.orderId}`, icon: "https://thetruescholars.com/wp-content/uploads/2026/11/true-scholars-icon-150x150.png" });
            n.onclick = () => {
              window.focus();
              router.push(inc.orderId ? `/messages?c=${inc.orderId}` : "/messages");
              n.close();
            };
          }
        }
      } else if (!first && lastNotes.current !== null && p.notifications > lastNotes.current) {
        playBell(); // a proposal, hire, payout or other alert (messages have their own sound above)
        setBump("notifications");
      }
      lastIncoming.current = p.incoming?.id ?? null;
      lastNotes.current = p.notifications;
    } catch {
      /* offline: try again next tick */
    }
  }, [router]);

  // Check soon after each page change, then every 4 s while visible (12 s in the background).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const loop = async () => {
      await check();
      if (alive) timer = setTimeout(loop, document.visibilityState === "visible" ? 4000 : 12000);
    };
    timer = setTimeout(loop, 600);
    const onVis = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [path, check]);

  // Unread messages in the tab title: "(2) Messages · The True Scholars"
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\+?\)\s/, "");
      document.title = c.messages > 0 ? `(${c.messages > 9 ? "9+" : c.messages}) ${base}` : base;
    };
    apply();
    const t = setTimeout(apply, 400); // after the new page sets its own title
    return () => clearTimeout(t);
  }, [c.messages, path]);

  useEffect(() => {
    if (!bump) return;
    const t = setTimeout(() => setBump(null), 700);
    return () => clearTimeout(t);
  }, [bump]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((x) => x.slice(1)), 7000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <>
      <Badge href="/messages" icon="message" label="Messages" n={c.messages} bump={bump === "messages"} />
      <Badge href="/notifications" icon="bell" label="Notifications" n={c.notifications} bump={bump === "notifications"} />
      <div className="pointer-events-none fixed right-3 bottom-3 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2 sm:right-5 sm:bottom-5" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.key} className="pointer-events-auto flex animate-[ts-toast-in_0.35s_cubic-bezier(.2,.9,.3,1.3)] items-start gap-3 rounded-md border border-line bg-white p-3.5 text-ink shadow-2xl">
            <span className="relative grid size-11 flex-none place-items-center rounded-full bg-green font-display text-sm font-bold text-amber">
              {initials(t.sender)}
              <span className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-white bg-amber" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <b className="truncate">{t.sender}</b>
                <span className="flex-none text-[11px] text-ink-muted">now</span>
              </div>
              {t.title && <div className="truncate text-xs text-ink-muted">{t.title}</div>}
              <p className="mt-0.5 line-clamp-2 text-sm">{t.preview || "Sent you a message"}</p>
              <div className="mt-2 flex gap-2">
                <Link href={t.orderId ? `/messages?c=${t.orderId}` : "/messages"} onClick={() => dismiss(t.key)} className="rounded-full bg-green px-3.5 py-1.5 text-xs font-bold text-white no-underline">
                  Reply
                </Link>
                <button type="button" onClick={() => dismiss(t.key)} className="rounded-full px-3 py-1.5 text-xs font-bold text-ink-muted hover:bg-parchment">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
