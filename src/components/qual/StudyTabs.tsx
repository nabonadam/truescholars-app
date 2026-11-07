"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function StudyTabs({ id, responses }: { id: string; responses: number }) {
  const path = usePathname();
  const tabs = [
    { href: `/tools/qual/${id}`, label: "Build" },
    { href: `/tools/qual/${id}/share`, label: "Share" },
    { href: `/tools/qual/${id}/responses`, label: `Responses${responses ? ` (${responses})` : ""}` },
    { href: `/tools/qual/${id}/analyse`, label: "Analyse" },
  ];
  return (
    <nav aria-label="Study" className="-mx-4 mt-5 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
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
