"use client";

import { useState } from "react";

export const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";

/**
 * A person's photo, or their initials when they haven't added one. Pass `src` when you have the
 * user's image URL (it carries a version, so it updates at once), or `userId` to look it up.
 */
export function Avatar({ name, size = 48, tone = "green", userId, src }: { name: string; size?: number; tone?: "green" | "amber"; userId?: string | null; src?: string | null }) {
  const [failed, setFailed] = useState(false);
  const url = src ?? (userId ? `/api/avatar/${userId}` : null);
  const box = { width: size, height: size };
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} onError={() => setFailed(true)} className="flex-none rounded-full bg-parchment object-cover" style={box} loading="lazy" />;
  }
  return (
    <span className={`grid flex-none place-items-center rounded-full font-display font-bold ${tone === "green" ? "bg-green text-amber" : "bg-amber text-ink"}`} style={{ ...box, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}
