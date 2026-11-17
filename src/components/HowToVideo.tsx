/** A short how-to video served from /public/videos. Loads nothing until the person presses play. */
export const HOWTOS = {
  stats: { title: "Run your first analysis", tool: "Statistics Assistant", length: "1 min" },
  qual: { title: "Run a qualitative study", tool: "Qualitative Studio", length: "1 min" },
  lit: { title: "Build a literature review", tool: "Literature Review", length: "1 min" },
  experts: { title: "Hire an expert, safely", tool: "Find Experts", length: "1 min" },
} as const;
export type HowTo = keyof typeof HOWTOS;

export function HowToVideo({ id, className = "" }: { id: HowTo; className?: string }) {
  const v = HOWTOS[id];
  return (
    <figure className={`overflow-hidden rounded-md border border-line bg-white ${className}`}>
      <video controls preload="none" playsInline poster={`/videos/howto-${id}.jpg`} className="block aspect-video w-full bg-green-deep">
        <source src={`/videos/howto-${id}.mp4`} type="video/mp4" />
      </video>
      <figcaption className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
        <span className="font-bold text-ink">How to: {v.title.toLowerCase()}</span>
        <span className="flex-none text-ink-muted">{v.length}</span>
      </figcaption>
    </figure>
  );
}
