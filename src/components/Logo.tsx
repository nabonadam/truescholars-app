/** The Cite Mark: citation brackets around an amber dot. `onDark` swaps the brackets to parchment. */
export function CiteMark({ size = 32, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M23 11H14V53H23M41 11H50V53H41"
        fill="none"
        stroke={onDark ? "#fbf4e8" : "#0f3d2a"}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="32" r="7.5" fill="#f4a261" />
    </svg>
  );
}

export function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CiteMark size={28} onDark={onDark} />
      <span className={`font-display text-lg tracking-tight sm:text-xl whitespace-nowrap ${onDark ? "text-white" : "text-ink"}`}>
        <span className="font-medium opacity-80">The</span> <span className="font-extrabold">True Scholars</span>
      </span>
    </span>
  );
}
