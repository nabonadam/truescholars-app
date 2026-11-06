import type { IconName } from "@/components/Icons";

export const CATEGORY_ICON: Record<string, IconName> = {
  "statistics-data-analysis": "chart",
  "academic-editing": "pen",
  "research-methodology": "flask",
  "qualitative-analysis": "quote",
  "literature-review-support": "book",
  transcription: "mic",
  "research-tutoring": "cap",
  "survey-design": "clipboard",
  "data-cleaning": "filter",
  "systematic-reviews": "layers",
  "research-programming": "code",
  "gis-spatial-analysis": "map",
  "academic-translation": "globe",
  "references-formatting": "list",
  "presentations-posters": "screen",
};

export const iconFor = (slug: string): IconName => CATEGORY_ICON[slug] ?? "spark";

/** Three brand looks for service covers, chosen per category so each category is recognisable. */
const COVERS = [
  { bg: "linear-gradient(135deg,#0f3d2a 0%,#0b2418 100%)", fg: "#f4a261", dot: "rgba(244,162,97,.18)" },
  { bg: "linear-gradient(135deg,#fce3cc 0%,#f4a261 100%)", fg: "#0f3d2a", dot: "rgba(15,61,42,.12)" },
  { bg: "linear-gradient(135deg,#e6f0e9 0%,#c9dfd0 100%)", fg: "#0f3d2a", dot: "rgba(244,162,97,.35)" },
];
export function coverFor(slug: string) {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVERS[h % COVERS.length];
}

export const POPULAR_SEARCHES = ["Stata regression", "NVivo coding", "Thesis editing", "Literature review", "SPSS analysis", "Questionnaire design"];
