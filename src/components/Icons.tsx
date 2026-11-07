/** Small line icons in the brand style (2px stroke, rounded), inside coloured tiles. */

const PATHS = {
  message: "M4 5h16v11H8l-4 4z",
  wallet: "M3 7h15a3 3 0 013 3v7a3 3 0 01-3 3H3zM3 7l12-3v3M16 13.5h.01",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 018 0v4",
  check: "M5 12l5 5 9-10",
  package: "M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 5v6h-6",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  bell: "M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  shield: "M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6zM9 12l2 2 4-4",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  card: "M3 6h18v12H3zM3 10h18",
  chart: "M4 20V11M10 20V5M16 20v-8M21 20H3",
  pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  book: "M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5M8 7h7",
  mic: "M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9M12 3c-2.5 2.7-3.5 5.7-3.5 9s1 6.3 3.5 9",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  quote: "M6 7h5v5c0 3-1.5 5-5 6M14 7h5v5c0 3-1.5 5-5 6",
  flask: "M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3M7.5 15h9",
  clipboard: "M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M9 11h6M9 15h4",
  cap: "M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5M22 9v5",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  list: "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01",
  screen: "M3 4h18v12H3zM8 20h8M12 16v4",
  scale: "M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 006 0zM19 8l-3 6a3 3 0 006 0z",
  trophy: "M8 4h8v5a4 4 0 01-8 0zM8 6H4v1a4 4 0 004 4M16 6h4v1a4 4 0 01-4 4M12 13v4M8 20h8",
  briefcase: "M3 8h18v12H3zM8 8V5h8v3M3 13h18",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  download: "M12 4v11M7 10l5 5 5-5M4 20h16",
  upload: "M12 20V9M7 14l5-5 5 5M4 4h16",
  play: "M7 4l13 8-13 8z",
  terminal: "M3 4h18v16H3zM7 9l3 3-3 3M13 15h4",
  table: "M3 5h18v14H3zM3 10h18M3 15h18M9 5v14",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3",
  x: "M6 6l12 12M18 6L6 18",
  copy: "M8 8h12v12H8zM4 16V4h12",
  wand: "M4 20L16 8M14 4v3M18 8h3M17.5 4.5l-1.5 1.5M19 11l-1-1",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

const TONES = {
  green: "bg-green-tint text-green",
  amber: "bg-amber-tint text-amber-deep",
  solid: "bg-green text-amber",
  ink: "bg-ink text-white",
} as const;

export function IconTile({ name, tone = "green", size = 44 }: { name: IconName; tone?: keyof typeof TONES; size?: number }) {
  return (
    <span className={`grid flex-none place-items-center rounded-sm ${TONES[tone]}`} style={{ width: size, height: size }}>
      <Icon name={name} size={Math.round(size * 0.48)} />
    </span>
  );
}

const KIND: Record<string, { icon: IconName; tone: keyof typeof TONES }> = {
  MESSAGE: { icon: "message", tone: "green" },
  ORDER_PAID: { icon: "lock", tone: "solid" },
  DELIVERED: { icon: "package", tone: "amber" },
  REVISION_REQUESTED: { icon: "refresh", tone: "amber" },
  PAYMENT_RELEASED: { icon: "wallet", tone: "solid" },
  REVIEW_RECEIVED: { icon: "star", tone: "amber" },
  APPLICATION_DECIDED: { icon: "shield", tone: "green" },
  NEW_PROPOSAL: { icon: "spark", tone: "amber" },
  HIRED: { icon: "check", tone: "solid" },
  PROPOSAL_DECLINED: { icon: "receipt", tone: "ink" },
  JOB_MATCH: { icon: "briefcase", tone: "green" },
  DISPUTE: { icon: "scale", tone: "amber" },
  PAYOUT: { icon: "wallet", tone: "solid" },
  LEVEL_UP: { icon: "trophy", tone: "amber" },
  TOOL_ACCESS: { icon: "chart", tone: "solid" },
  STUDY_RESPONSE: { icon: "mic", tone: "solid" },
  LIT_REVIEW: { icon: "book", tone: "solid" },
};

export function KindIcon({ kind }: { kind: string }) {
  const k = KIND[kind] ?? { icon: "bell", tone: "green" };
  return <IconTile name={k.icon} tone={k.tone} size={40} />;
}
