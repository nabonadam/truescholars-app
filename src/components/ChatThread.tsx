import { formatBytes } from "@/server/files";

type Meta = Map<string, { name: string; sizeBytes: number }>;
type Msg = { id: string; body: string; files: string[]; flagged: boolean; createdAt: Date; senderId: string; senderName: string | null };

const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function dayLabel(d: Date) {
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function FileLinks({ ids, meta, onDark = false }: { ids: string[]; meta: Meta; onDark?: boolean }) {
  if (ids.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {ids.map((id) => {
        const f = meta.get(id);
        return f ? (
          <li key={id}>
            <a
              href={`/api/files/${id}`}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold no-underline ${onDark ? "border-white/30 bg-white/10 text-white" : "border-line bg-white text-green"}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
              {f.name} <span className={onDark ? "font-normal text-white/70" : "font-normal text-ink-muted"}>{formatBytes(f.sizeBytes)}</span>
            </a>
          </li>
        ) : null;
      })}
    </ul>
  );
}

/** A conversation, oldest at the top, scrolled to the newest message, with a label for each day. */
export function ChatThread({ msgs, meta, viewerId, className = "", empty }: { msgs: Msg[]; meta: Meta; viewerId: string; className?: string; empty: string }) {
  let lastDay = "";
  return (
    // column-reverse keeps the scroll pinned to the newest message
    <div className={`flex flex-col-reverse overflow-y-auto ${className}`}>
      <ol className="flex flex-col gap-3" aria-live="polite">
        {msgs.length === 0 && <li className="py-6 text-center text-sm text-ink-muted">{empty}</li>}
        {msgs.map((m, i) => {
          const mine = m.senderId === viewerId;
          const day = dayLabel(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          const prev = msgs[i - 1];
          const grouped = !showDay && prev && prev.senderId === m.senderId && m.createdAt.getTime() - prev.createdAt.getTime() < 5 * 60_000;
          return (
            <li key={m.id} className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"} ${grouped ? "-mt-2" : ""}`}>
              {showDay && (
                <div className="my-2 flex w-full items-center gap-3 text-xs font-bold text-ink-muted">
                  <span className="h-px flex-1 bg-line" />
                  {day}
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              {!grouped && !mine && <span className="text-xs font-bold text-ink-muted">{m.senderName}</span>}
              {m.body && (
                <div className={`max-w-[85%] rounded-md px-4 py-2 text-[15px] ${mine ? "rounded-br-none bg-green text-white" : "rounded-bl-none bg-parchment text-ink"}`}>
                  <p className="whitespace-pre-line break-words">{m.body}</p>
                </div>
              )}
              <FileLinks ids={m.files} meta={meta} />
              {m.flagged && (
                <p className="max-w-[85%] rounded-sm bg-amber-tint px-3 py-2 text-xs text-amber-deep" role="note">
                  Contact details detected. For your protection, keep messages and payment on The True Scholars. Our team reviews flagged messages.
                </p>
              )}
              <span className="text-[11px] text-ink-muted">{time(m.createdAt)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
