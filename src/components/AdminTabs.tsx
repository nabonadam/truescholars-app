import Link from "next/link";

const TABS = [
  { href: "/admin/applications", label: "Expert applications" },
  { href: "/admin/messages", label: "Flagged messages" },
] as const;

export function AdminTabs({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Admin sections" className="flex flex-wrap gap-2 border-b border-line pb-3">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active === t.href ? "page" : undefined}
          className={`rounded-full px-4 py-2 text-sm font-bold no-underline ${active === t.href ? "bg-ink text-white" : "text-ink hover:bg-white"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
