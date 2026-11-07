"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function LitTabs({ id, counts, expert }: { id: string; counts: { papers: number; pending: number; read: number }; expert?: boolean }) {
  const path = usePathname();
  const tabs = expert
    ? [{ href: `/tools/lit/${id}`, label: "Literature retrieval" }]
    : [
        { href: `/tools/lit/${id}`, label: `Papers${counts.papers ? ` (${counts.papers})` : ""}${counts.pending ? ` · ${counts.pending} to review` : ""}` },
        { href: `/tools/lit/${id}/reading`, label: `Reading${counts.read ? ` (${counts.read})` : ""}` },
        { href: `/tools/lit/${id}/synthesis`, label: "Synthesis" },
        { href: `/tools/lit/${id}/write`, label: "Write" },
        { href: `/tools/lit/${id}/brief`, label: "Brief" },
      ];
  return (
    <nav aria-label="Review" className="-mx-4 mt-5 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => {
        const on = path === t.href;
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={`shrink-0 rounded-t-[12px] px-4 py-2.5 text-sm font-bold no-underline ${on ? "bg-parchment text-ink" : "text-on-green-muted hover:bg-white/10 hover:text-white"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
