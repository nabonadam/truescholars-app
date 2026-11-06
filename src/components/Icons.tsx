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
  scale: "M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 006 0zM19 8l-3 6a3 3 0 006 0z",
  trophy: "M8 4h8v5a4 4 0 01-8 0zM8 6H4v1a4 4 0 004 4M16 6h4v1a4 4 0 01-4 4M12 13v4M8 20h8",
  briefcase: "M3 8h18v12H3zM8 8V5h8v3M3 13h18",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
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
};

export function KindIcon({ kind }: { kind: string }) {
  const k = KIND[kind] ?? { icon: "bell", tone: "green" };
  return <IconTile name={k.icon} tone={k.tone} size={40} />;
}
