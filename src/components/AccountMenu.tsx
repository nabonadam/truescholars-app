"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { AlertSettings } from "./AlertSettings";

type Item = { href: string; label: string };

/** Avatar button with everything account-related, so the header stays on one line on phones. */
export function AccountMenu({ name, email, roles }: { name: string; email: string; roles: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isExpert = roles.includes("EXPERT");
  const initials = (name || email).split(/[\s@]/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const groups: { title: string; items: Item[] }[] = [
    { title: "", items: [{ href: "/dashboard", label: "Dashboard" }, { href: "/messages", label: "Messages" }, { href: "/orders", label: "Orders" }] },
    { title: "Hiring", items: [{ href: "/jobs/new", label: "Post a job" }, { href: "/jobs/mine", label: "My jobs" }, { href: "/services", label: "Find experts" }] },
    isExpert
      ? {
          title: "Working",
          items: [
            { href: "/jobs", label: "Find work" },
            { href: "/proposals", label: "My proposals" },
            { href: "/expert/services", label: "My services" },
            { href: "/earnings", label: "Earnings" },
            { href: "/expert/level", label: "Your level" },
          ],
        }
      : { title: "Working", items: [{ href: "/apply", label: "Become an expert" }] },
  ];
  if (roles.includes("ADMIN")) groups.push({ title: "Admin", items: [{ href: "/admin", label: "Overview" }, { href: "/admin/applications", label: "Applications" }, { href: "/admin/disputes", label: "Disputes" }, { href: "/admin/payouts", label: "Payouts" }, { href: "/admin/messages", label: "Flagged messages" }] });

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="grid size-11 place-items-center rounded-full"
      >
        <span className="grid size-9 place-items-center rounded-full bg-amber font-display text-sm font-bold text-ink ring-2 ring-white/30">{initials}</span>
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-50 mt-2 w-72 overflow-hidden rounded-md border border-line bg-white text-ink shadow-xl">
          <div className="border-b border-line bg-parchment px-4 py-3">
            <div className="truncate font-bold">{name || "Your account"}</div>
            <div className="truncate text-xs text-ink-muted">{email}</div>
          </div>
          <div className="max-h-[70dvh] overflow-y-auto py-1">
            {groups.map((g) => (
              <div key={g.title || "main"} className="border-b border-line py-1 last:border-0">
                {g.title && <div className="px-4 pt-2 pb-1 text-[11px] font-bold tracking-wider text-ink-muted uppercase">{g.title}</div>}
                {g.items.map((i) => (
                  <Link key={i.href} role="menuitem" href={i.href} className={`block px-4 py-2.5 text-[15px] no-underline hover:bg-parchment ${path === i.href ? "font-bold text-green" : "text-ink"}`}>
                    {i.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-line py-1">
            <div className="px-4 pt-2 pb-1 text-[11px] font-bold tracking-wider text-ink-muted uppercase">Alerts</div>
            <AlertSettings compact />
          </div>
          <form action={signOutAction} className="border-t border-line">
            <button role="menuitem" className="w-full px-4 py-3 text-left text-[15px] font-bold text-ink hover:bg-parchment">Sign out</button>
          </form>
        </div>
      )}
    </div>
  );
}
