/** Paper metadata and citations in the common academic styles. Pure functions, used on server and client. */

export type Author = { family: string; given?: string };
export type PaperMeta = {
  title?: string;
  authors?: Author[];
  year?: number | null;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  publisher?: string;
  type?: string; // journal-article | book | book-chapter | report | thesis | other
  abstract?: string;
};

export const STYLES = { apa: "APA 7", harvard: "Harvard", mla: "MLA 9", chicago: "Chicago (author-date)", vancouver: "Vancouver" } as const;
export type Style = keyof typeof STYLES;
export const isStyle = (s: string): s is Style => s in STYLES;

export const pno = (n: number) => `P${String(n).padStart(2, "0")}`;
const initials = (g = "") => g.split(/[\s.-]+/).filter(Boolean).map((x) => `${x[0].toUpperCase()}.`).join(" ");
const yr = (m: PaperMeta) => (m.year ? String(m.year) : "n.d.");

/** "Mensah", "Mensah & Owusu", "Mensah et al." (APA/Harvard/Chicago rules for in-text). */
export function shortAuthors(m: PaperMeta, style: Style = "apa"): string {
  const a = m.authors ?? [];
  if (!a.length) return (m.title ?? "Untitled").split(/\s+/).slice(0, 4).join(" ");
  if (a.length === 1) return a[0].family;
  if (a.length === 2) return `${a[0].family} ${style === "apa" ? "&" : "and"} ${a[1].family}`;
  if (style === "chicago" && a.length === 3) return `${a[0].family}, ${a[1].family}, and ${a[2].family}`;
  return `${a[0].family} et al.`;
}

/** One parenthetical citation for several papers: (Mensah, 2020; Owusu & Boateng, 2021) or [3, 7]. */
export function inText(papers: { meta: PaperMeta; n: number; ref?: number }[], style: Style): string {
  if (!papers.length) return "";
  if (style === "vancouver") return `[${[...new Set(papers.map((p) => p.ref ?? p.n))].sort((a, b) => a - b).join(", ")}]`;
  const parts = papers.map((p) => (style === "apa" ? `${shortAuthors(p.meta, style)}, ${yr(p.meta)}` : style === "mla" ? shortAuthors(p.meta, style) : `${shortAuthors(p.meta, style)} ${yr(p.meta)}`));
  return `(${[...new Set(parts)].join("; ")})`;
}

const doiUrl = (m: PaperMeta) => (m.doi ? `https://doi.org/${m.doi}` : m.url ?? "");
const span = (m: PaperMeta) => [m.volume, m.issue ? `(${m.issue})` : ""].join("");

/** A reference-list entry (plain text; *asterisks* mark italics for Word export). */
export function reference(m: PaperMeta, style: Style, ref?: number): string {
  const a = m.authors ?? [];
  const title = (m.title ?? "Untitled").replace(/\.$/, "");
  const link = doiUrl(m);
  if (style === "apa") {
    const names = a.length > 20 ? [...a.slice(0, 19), a[a.length - 1]] : a;
    const list = names.map((x) => `${x.family}${x.given ? `, ${initials(x.given)}` : ""}`);
    const who = list.length <= 1 ? list[0] ?? "" : `${list.slice(0, -1).join(", ")}, & ${list[list.length - 1]}`;
    return `${who ? `${who} ` : ""}(${yr(m)}). ${title}. ${m.journal ? `*${m.journal}*` : ""}${m.volume ? `, *${m.volume}*` : ""}${m.issue ? `(${m.issue})` : ""}${m.pages ? `, ${m.pages}` : ""}${m.journal ? "." : ""}${link ? ` ${link}` : ""}`.replace(/\s+/g, " ").trim();
  }
  if (style === "harvard") {
    const who = a.map((x) => `${x.family}${x.given ? `, ${initials(x.given)}` : ""}`).join(a.length > 2 ? ", " : " and ").replace(/, ([^,]+)$/, a.length > 2 ? " and $1" : ", $1");
    return `${who} (${yr(m)}) '${title}', ${m.journal ? `*${m.journal}*` : ""}${span(m) ? `, ${span(m)}` : ""}${m.pages ? `, pp. ${m.pages}` : ""}.${link ? ` Available at: ${link}.` : ""}`.replace(/\s+/g, " ").trim();
  }
  if (style === "mla") {
    const who = a.length === 0 ? "" : a.length === 1 ? `${a[0].family}, ${a[0].given ?? ""}` : a.length === 2 ? `${a[0].family}, ${a[0].given ?? ""}, and ${a[1].given ?? ""} ${a[1].family}` : `${a[0].family}, ${a[0].given ?? ""}, et al`;
    return `${who ? `${who.trim()}. ` : ""}"${title}." ${m.journal ? `*${m.journal}*, ` : ""}${m.volume ? `vol. ${m.volume}, ` : ""}${m.issue ? `no. ${m.issue}, ` : ""}${m.year ?? ""}${m.pages ? `, pp. ${m.pages}` : ""}.${link ? ` ${link.replace(/^https:\/\//, "")}.` : ""}`.replace(/\s+/g, " ").trim();
  }
  if (style === "chicago") {
    const who = a.map((x, i) => (i === 0 ? `${x.family}${x.given ? `, ${x.given}` : ""}` : `${x.given ? `${x.given} ` : ""}${x.family}`));
    const names = who.length <= 1 ? who[0] ?? "" : `${who.slice(0, -1).join(", ")}, and ${who[who.length - 1]}`;
    return `${names ? `${names}. ` : ""}${yr(m)}. "${title}." ${m.journal ? `*${m.journal}* ` : ""}${span(m)}${m.pages ? `: ${m.pages}` : ""}.${link ? ` ${link}.` : ""}`.replace(/\s+/g, " ").replace(/ \./g, ".").trim();
  }
  // vancouver
  const who = (a.length > 6 ? [...a.slice(0, 6)] : a).map((x) => `${x.family} ${(x.given ?? "").split(/[\s.-]+/).filter(Boolean).map((g) => g[0]).join("")}`).join(", ") + (a.length > 6 ? ", et al" : "");
  return `${ref ? `${ref}. ` : ""}${who ? `${who}. ` : ""}${title}. ${m.journal ? `${m.journal}. ` : ""}${m.year ?? ""}${m.volume ? `;${m.volume}` : ""}${m.issue ? `(${m.issue})` : ""}${m.pages ? `:${m.pages}` : ""}.${m.doi ? ` doi:${m.doi}` : ""}`.replace(/\s+/g, " ").trim();
}

/** Sort order of the reference list: alphabetical by first author, except Vancouver (order of citation). */
export function sortForReferences<T extends { meta: PaperMeta; n: number }>(papers: T[], style: Style): T[] {
  if (style === "vancouver") return [...papers];
  return [...papers].sort((x, y) => (x.meta.authors?.[0]?.family ?? x.meta.title ?? "").localeCompare(y.meta.authors?.[0]?.family ?? y.meta.title ?? "") || (x.meta.year ?? 0) - (y.meta.year ?? 0));
}

export function ris(m: PaperMeta): string {
  const lines = [`TY  - ${m.type === "book" ? "BOOK" : m.type === "book-chapter" ? "CHAP" : m.type === "report" ? "RPRT" : m.type === "thesis" ? "THES" : "JOUR"}`, ...(m.authors ?? []).map((a) => `AU  - ${a.family}${a.given ? `, ${a.given}` : ""}`), `TI  - ${m.title ?? ""}`];
  if (m.journal) lines.push(`JO  - ${m.journal}`);
  if (m.year) lines.push(`PY  - ${m.year}`);
  if (m.volume) lines.push(`VL  - ${m.volume}`);
  if (m.issue) lines.push(`IS  - ${m.issue}`);
  if (m.pages) {
    const [sp, ep] = m.pages.split(/[-–]/);
    lines.push(`SP  - ${sp}`);
    if (ep) lines.push(`EP  - ${ep}`);
  }
  if (m.doi) lines.push(`DO  - ${m.doi}`);
  if (m.abstract) lines.push(`AB  - ${m.abstract.replace(/\s+/g, " ")}`);
  lines.push("ER  - ");
  return lines.join("\r\n");
}

export function bibtex(m: PaperMeta, key: string): string {
  const esc = (s: string) => s.replace(/[{}]/g, "");
  const f: [string, string | undefined][] = [
    ["author", (m.authors ?? []).map((a) => `${esc(a.family)}${a.given ? `, ${esc(a.given)}` : ""}`).join(" and ")],
    ["title", m.title && `{${esc(m.title)}}`],
    ["journal", m.journal && esc(m.journal)],
    ["year", m.year ? String(m.year) : undefined],
    ["volume", m.volume],
    ["number", m.issue],
    ["pages", m.pages?.replace(/[-–]/, "--")],
    ["doi", m.doi],
  ];
  return `@${m.type === "book" ? "book" : "article"}{${key},\n${f.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(",\n")}\n}`;
}

export const bibKey = (m: PaperMeta, n: number) => `${(m.authors?.[0]?.family ?? "paper").normalize("NFKD").replace(/[^A-Za-z]/g, "").toLowerCase() || "paper"}${m.year ?? ""}_${n}`;
