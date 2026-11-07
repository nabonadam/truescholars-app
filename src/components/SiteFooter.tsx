import Link from "next/link";
import { site } from "@/lib/site";
import { CiteMark } from "./Logo";

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Platform",
    links: [
      { label: "Find experts", href: "/services" },
      { label: "Post a job", href: "/jobs/new" },
      { label: "AI tools", href: site("/#tools"), external: true },
      { label: "Pricing", href: site("/pricing/"), external: true },
      { label: "How it works", href: site("/how-it-works/"), external: true },
    ],
  },
  {
    title: "Experts",
    links: [
      { label: "Find work", href: "/jobs" },
      { label: "Apply to join", href: "/apply" },
      { label: "How vetting works", href: site("/how-vetting-works/"), external: true },
    ],
  },
  {
    title: "Trust",
    links: [
      { label: "Academic integrity", href: site("/academic-integrity/"), external: true },
      { label: "Privacy", href: site("/privacy-policy/"), external: true },
      { label: "Terms of service", href: site("/terms/"), external: true },
      { label: "Refund policy", href: site("/refund-policy/"), external: true },
    ],
  },
];

/** Same footer as thetruescholars.com, so the app reads as part of one site. */
export function SiteFooter() {
  return (
    <footer className="site-footer bg-green-deep text-[14px] text-[#bccdc1]">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pt-12 pb-7 sm:px-6">
        <div className="flex flex-wrap gap-x-12 gap-y-7">
          <div className="flex flex-[2_1_260px] flex-col gap-2.5">
            <a href={site("/")} className="inline-flex items-center gap-2.5 no-underline">
              <CiteMark size={30} onDark />
              <span className="font-display text-2xl font-extrabold text-white">The True Scholars</span>
            </a>
            <p className="m-0 max-w-[300px]">Vetted academic experts and research-grade AI tools, in one trusted place.</p>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.title} className="flex flex-[1_1_140px] flex-col gap-2">
              <div className="font-bold text-white">{c.title}</div>
              {c.links.map((l) =>
                l.external ? (
                  <a key={l.label} href={l.href} className="text-[#bccdc1] no-underline hover:text-white">{l.label}</a>
                ) : (
                  <Link key={l.label} href={l.href} className="text-[#bccdc1] no-underline hover:text-white">{l.label}</Link>
                ),
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-between gap-2.5 border-t border-white/12 pt-5">
          <span>
            © {new Date().getFullYear()} The True Scholars ·{" "}
            <a href={site("/about/")} className="text-[#bccdc1] no-underline hover:text-white">About us</a> ·{" "}
            <a href={site("/contact/")} className="text-[#bccdc1] no-underline hover:text-white">Contact</a>
          </span>
          <a href="mailto:hello@thetruescholars.com" className="text-[#bccdc1] no-underline hover:text-white">hello@thetruescholars.com</a>
        </div>
      </div>
    </footer>
  );
}
