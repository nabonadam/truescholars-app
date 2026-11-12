/**
 * Paid plans for the AI tools, in two price lists: GH₵ for Ghana and the rest of Africa, US$ for
 * everyone else. Change prices here and nowhere else. Paystack (a Ghana business) charges in cedis
 * only, so a US$ price is charged as its cedi equivalent at the day's rate.
 */

export type PlanId = "stats" | "qual" | "lit" | "all" | "api";
export type PlanTool = "stats" | "qual" | "lit";
export type Currency = "GHS" | "USD";

/** Monthly price in whole cedis and whole dollars. */
export const PLANS: Record<PlanId, { name: string; tools: PlanTool[]; GHS: number; USD: number }> = {
  stats: { name: "Statistics Assistant", tools: ["stats"], GHS: 129, USD: 15 },
  qual: { name: "Qualitative Studio", tools: ["qual"], GHS: 159, USD: 19 },
  lit: { name: "Literature Review", tools: ["lit"], GHS: 189, USD: 24 },
  all: { name: "All three tools", tools: ["stats", "qual", "lit"], GHS: 379, USD: 45 },
  // for organisations: the Qualitative Studio plus the developer API, webhooks and 5× the transcription allowance
  api: { name: "Qualitative Studio API", tools: ["qual"], GHS: 669, USD: 79 },
};

/** Literature retrieval by an expert, per paper (the admin's starting price when assigning). */
export const RETRIEVAL_PER_PAPER: Record<Currency, number> = { GHS: 30, USD: 4.5 };

/** Lengths on offer, with the discount for paying for longer. */
export const TERMS = [
  { months: 1, discount: 0 },
  { months: 3, discount: 0.1 },
  { months: 12, discount: 0.25 },
] as const;
export type Months = (typeof TERMS)[number]["months"];

export const isPlan = (p: unknown): p is PlanId => typeof p === "string" && p in PLANS;
export const isMonths = (m: unknown): m is Months => TERMS.some((t) => t.months === m);
export const isCurrency = (c: unknown): c is Currency => c === "GHS" || c === "USD";

/** The price of a plan for a length, in whole units of the currency (rounded to the nearest unit). */
export function planPrice(plan: PlanId, months: Months, currency: Currency = "GHS") {
  const t = TERMS.find((x) => x.months === months)!;
  return Math.round(PLANS[plan][currency] * months * (1 - t.discount));
}

/** What Paystack charges, in pesewas: cedi prices as they are, dollar prices converted (rounded up to a whole cedi). */
export function chargeGhsMinor(amount: number, currency: Currency, usdToGhs: number) {
  return currency === "GHS" ? Math.round(amount * 100) : Math.ceil(amount * usdToGhs) * 100;
}

export const money = (amount: number, currency: Currency) =>
  currency === "GHS" ? `GH₵${amount.toLocaleString("en-GB", { maximumFractionDigits: 2 })}` : `$${amount.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;

export const DAYS_PER_MONTH = 30;
export const TOOL_PATH: Record<PlanTool, string> = { stats: "/tools/stats", qual: "/tools/qual", lit: "/tools/lit" };

const AFRICAN = new Set([
  "algeria", "angola", "benin", "botswana", "burkina faso", "burundi", "cabo verde", "cape verde", "cameroon", "central african republic",
  "chad", "comoros", "congo", "republic of the congo", "democratic republic of the congo", "dr congo", "drc", "djibouti", "egypt",
  "equatorial guinea", "eritrea", "eswatini", "swaziland", "ethiopia", "gabon", "gambia", "the gambia", "ghana", "guinea", "guinea-bissau",
  "ivory coast", "côte d'ivoire", "cote d'ivoire", "kenya", "lesotho", "liberia", "libya", "madagascar", "malawi", "mali", "mauritania",
  "mauritius", "morocco", "mozambique", "namibia", "niger", "nigeria", "rwanda", "sao tome and principe", "são tomé and príncipe",
  "senegal", "seychelles", "sierra leone", "somalia", "south africa", "south sudan", "sudan", "tanzania", "togo", "tunisia", "uganda",
  "zambia", "zimbabwe",
]);

/** GH₵ for people in Africa, US$ elsewhere; null when they haven't given a country. */
export function currencyForCountry(country?: string | null): Currency | null {
  const c = (country ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]/g, "");
  if (!c) return null;
  return AFRICAN.has(c) ? "GHS" : "USD";
}

/** From the browser's time zone, for people who haven't given a country. */
export const currencyForTimeZone = (tz?: string) => (tz?.startsWith("Africa/") ? "GHS" : tz ? "USD" : null);
