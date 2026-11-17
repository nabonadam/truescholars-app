import Link from "next/link";
import { HOWTOS, HowToVideo, type HowTo } from "@/components/HowToVideo";

export const metadata = { title: "How-to videos" };

const LINKS: Record<HowTo, string> = { stats: "/tools/stats", qual: "/tools/qual", lit: "/tools/lit", experts: "/services" };

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <h1 className="text-[32px] leading-tight font-extrabold sm:text-[40px]">How-to videos</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">One minute each: watch how every part of The True Scholars works, step by step.</p>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {(Object.keys(HOWTOS) as HowTo[]).map((id) => (
          <div key={id} id={id} className="flex scroll-mt-6 flex-col gap-2">
            <span className="eyebrow">{HOWTOS[id].tool}</span>
            <HowToVideo id={id} />
            <Link href={LINKS[id]} className="text-sm font-bold text-green">Open {HOWTOS[id].tool} →</Link>
          </div>
        ))}
      </div>
      <p className="mt-10 text-sm text-ink-muted">Still stuck? Email <a href="mailto:hello@thetruescholars.com" className="font-bold text-green">hello@thetruescholars.com</a> and we&apos;ll help.</p>
    </div>
  );
}
