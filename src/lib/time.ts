/** "just now", "5 min ago", "3 hours ago", "2 days ago", then a date. */
export function ago(d: Date, now = new Date()) {
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (s < 7 * 86400) {
    const days = Math.floor(s / 86400);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export const memberSince = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
