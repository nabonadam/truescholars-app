import Link from "next/link";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/applications", label: "Expert applications" },
  { href: "/admin/disputes", label: "Disputes" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/messages", label: "Flagged messages" },
  { href: "/admin/stats", label: "Statistics access" },
  { href: "/admin/qual", label: "Qualitative access" },
  { href: "/admin/lit", label: "Literature access" },
] as const;

export function AdminTabs({ active, counts = {} }: { active: (typeof TABS)[number]["href"]; counts?: Partial<Record<(typeof TABS)[number]["href"], number>> }) {
  return (
    <nav aria-label="Admin sections" className="-mx-4 flex gap-2 overflow-x-auto border-b border-line px-4 pb-3 sm:mx-0 sm:flex-wrap sm:px-0">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active === t.href ? "page" : undefined}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-bold no-underline ${active === t.href ? "bg-ink text-white" : "text-ink hover:bg-white"}`}
        >
          {t.label}
          {counts[t.href] ? <span className="rounded-full bg-amber px-2 text-xs text-ink">{counts[t.href]}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
