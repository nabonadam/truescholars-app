const STEPS = ["Paid", "In progress", "Delivered", "Approved"];

/** Paid → In progress → Delivered → Approved. `step` is the last reached (-1 = not paid yet). */
export function OrderProgress({ step, compact = false }: { step: number; compact?: boolean }) {
  return (
    <ol className="flex items-center" aria-label={step < 0 ? "Not paid yet" : `Progress: ${STEPS[step]}`}>
      {STEPS.map((label, i) => {
        const done = i <= step;
        const current = i === step;
        return (
          <li key={label} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
            <div className="flex flex-col items-center gap-1">
              <span
                className={`grid place-items-center rounded-full text-[10px] font-bold ${compact ? "size-5" : "size-7"} ${
                  done ? "bg-green text-white" : "border-2 border-line bg-white text-ink-muted"
                } ${current ? "ring-4 ring-amber/40" : ""}`}
                aria-hidden="true"
              >
                {done ? "✓" : i + 1}
              </span>
              {!compact && <span className={`text-[11px] whitespace-nowrap ${done ? "font-bold text-ink" : "text-ink-muted"}`}>{label}</span>}
            </div>
            {i < STEPS.length - 1 && (
              <span className={`mx-1 h-1 flex-1 rounded-full ${i < step ? "bg-green" : "bg-line"} ${compact ? "" : "-mt-5"}`} aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
