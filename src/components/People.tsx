export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";

export function Avatar({ name, size = 48, tone = "green" }: { name: string; size?: number; tone?: "green" | "amber" }) {
  return (
    <span
      className={`grid flex-none place-items-center rounded-full font-display font-bold ${tone === "green" ? "bg-green text-amber" : "bg-amber text-ink"}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

export function Stars({ rating, count, small = false }: { rating: number | null; count: number; small?: boolean }) {
  if (rating === null || count === 0) return <span className={`text-ink-muted ${small ? "text-xs" : "text-sm"}`}>No reviews yet</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${small ? "text-xs" : "text-sm"}`}>
      <svg width={small ? 13 : 15} height={small ? 13 : 15} viewBox="0 0 24 24" fill="#f4a261" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></svg>
      <b>{rating.toFixed(1)}</b>
      <span className="text-ink-muted">({count})</span>
    </span>
  );
}

export const LEVEL_LABEL: Record<string, string> = { NEW: "New expert", LEVEL_1: "Level 1", LEVEL_2: "Level 2", TOP_RATED: "Top rated" };
