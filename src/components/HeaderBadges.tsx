"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icons";

function Badge({ href, icon, label, n }: { href: string; icon: IconName; label: string; n: number }) {
  return (
    <Link href={href} aria-label={n > 0 ? `${label}, ${n} unread` : label} className="relative grid size-11 place-items-center rounded-full text-white hover:bg-white/10">
      <Icon name={icon} size={22} />
      {n > 0 && <span className="absolute top-1 right-1 grid min-w-5 place-items-center rounded-full bg-amber px-1 text-[11px] font-bold text-ink">{n > 9 ? "9+" : n}</span>}
    </Link>
  );
}

/** Message and notification icons whose counts stay current as you read and as new things arrive. */
export function HeaderBadges({ messages, notifications }: { messages: number; notifications: number }) {
  const [c, setC] = useState({ messages, notifications });
  const path = usePathname();
  useEffect(() => setC({ messages, notifications }), [messages, notifications]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/inbox/pulse", { cache: "no-store" });
        if (r.ok && alive) {
          const j = (await r.json()) as { messages: number; notifications: number };
          setC({ messages: j.messages, notifications: j.notifications });
        }
      } catch {
        /* offline */
      }
    };
    const first = setTimeout(load, 600); // after the page has marked things read
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(t);
    };
  }, [path]);
  return (
    <>
      <Badge href="/messages" icon="message" label="Messages" n={c.messages} />
      <Badge href="/notifications" icon="bell" label="Notifications" n={c.notifications} />
    </>
  );
}
