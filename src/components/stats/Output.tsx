/** How results look: a Stata-style Results window, and APA tables on paper. */

import type { ReactNode } from "react";
import type { TableOut } from "@/server/stats";

const NUM = /(-?(?:\d[\d,]*)?\.?\d+(?:e[+-]\d+)?%?)/gi;

/** One output line, coloured like Stata's results: text in mint, numbers in cream, rules dimmed. */
function Line({ text }: { text: string }) {
  if (/^[\s\-+|=]+$/.test(text)) return <span className="text-[#3f6152]">{text}</span>;
  const out: ReactNode[] = [];
  let k = 0;
  // split on the table bar so the row labels and the numbers can be told apart
  for (const [i, part] of text.split(/(\|)/).entries()) {
    if (part === "|") {
      out.push(<span key={k++} className="text-[#3f6152]">|</span>);
      continue;
    }
    const isLabel = i === 0 && text.includes("|");
    let last = 0;
    for (const m of part.matchAll(NUM)) {
      const idx = m.index ?? 0;
      const before = part.slice(last, idx);
      const prev = part[idx - 1];
      const isWordPart = prev && /[A-Za-z_]/.test(prev); // e.g. "R2", "_cons", "q1"
      if (before) out.push(<span key={k++} className={isLabel ? "text-[#cfe3d6]" : "text-[#8fbfa3]"}>{before}</span>);
      out.push(
        <span key={k++} className={isWordPart || isLabel ? "text-[#cfe3d6]" : "text-[#f7dcb3]"}>
          {m[0]}
        </span>,
      );
      last = idx + m[0].length;
    }
    const tail = part.slice(last);
    if (tail) out.push(<span key={k++} className={isLabel ? "text-[#cfe3d6]" : "text-[#8fbfa3]"}>{tail}</span>);
  }
  return <>{out}</>;
}

export function StataLog({ text }: { text: string }) {
  return (
    <pre className="stata-scroll overflow-x-auto font-mono text-[12.5px] leading-[1.45] whitespace-pre">
      {text.split("\n").map((l, i) => (
        <div key={i} className="min-h-[1.45em]">
          <Line text={l} />
        </div>
      ))}
    </pre>
  );
}

/** A command as Stata echoes it: ". regress y x" with the command word bold. */
export function CommandEcho({ command, dim = false }: { command: string; dim?: boolean }) {
  const m = command.match(/^((?:by\w*\s+[^:]+:\s*)?)(\S+)(.*)$/s);
  return (
    <div className={`font-mono text-[13px] leading-snug break-all ${dim ? "opacity-50" : ""}`}>
      <span className="mr-2 text-amber">.</span>
      {m ? (
        <>
          <span className="text-white/70">{m[1]}</span>
          <span className="font-bold text-white">{m[2]}</span>
          <span className="text-white">{m[3]}</span>
        </>
      ) : (
        <span className="text-white">{command}</span>
      )}
    </div>
  );
}

export function ApaTable({ table, n }: { table: TableOut; n: number }) {
  const groups = new Set(table.groups);
  return (
    <figure className="apa overflow-x-auto bg-white px-5 py-5 text-[#111] sm:px-7">
      <figcaption className="mb-2">
        <div className="font-bold">Table {n}</div>
        <div className="italic">{table.title}</div>
      </figcaption>
      <table className="w-full min-w-[420px] border-collapse text-[14px]">
        <thead>
          <tr className="border-y border-black">
            {table.columns.map((c, j) => (
              <th key={j} className={`px-2 py-1.5 font-normal ${j === 0 ? "text-left" : "text-center"}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className={i === table.rows.length - 1 ? "border-b border-black" : ""}>
              {table.columns.map((_, j) => {
                const v = row[j] ?? "";
                const indent = j === 0 && v.startsWith(" ");
                return (
                  <td key={j} className={`px-2 py-1 align-top ${j === 0 ? "text-left" : "text-center tabular-nums whitespace-nowrap"} ${groups.has(i) && j === 0 ? "pt-2 italic" : ""} ${indent ? "pl-6" : ""}`}>
                    {v.trim()}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {table.note && (
        <p className="mt-2 text-[12.5px] leading-snug">
          <span className="italic">Note.</span> {table.note}
        </p>
      )}
    </figure>
  );
}

/** Tab-separated text, so a table pastes cleanly into Word or Excel. */
export function tableAsText(t: TableOut) {
  return [t.title, t.columns.join("\t"), ...t.rows.map((r) => r.map((c) => c.trim()).join("\t")), t.note ? `Note. ${t.note}` : ""].filter(Boolean).join("\n");
}
