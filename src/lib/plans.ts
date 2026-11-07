/**
 * Paid plans for the AI tools. PLACEHOLDER PRICES (in pesewas) until the real ones are set:
 * change them here and nowhere else.
 */

export type PlanId = "stats" | "qual" | "lit" | "all";
export type PlanTool = "stats" | "qual" | "lit";

export const PLANS: Record<PlanId, { name: string; tools: PlanTool[]; monthlyMinor: number }> = {
  stats: { name: "Statistics Assistant", tools: ["stats"], monthlyMinor: 60_00 },
  qual: { name: "Qualitative Studio", tools: ["qual"], monthlyMinor: 80_00 },
  lit: { name: "Literature Review", tools: ["lit"], monthlyMinor: 100_00 },
  all: { name: "All three tools", tools: ["stats", "qual", "lit"], monthlyMinor: 180_00 },
};

/** Lengths on offer, with the discount for paying for longer. */
export const TERMS = [
  { months: 1, discount: 0 },
  { months: 3, discount: 0.1 },
] as const;
export type Months = (typeof TERMS)[number]["months"];

export const isPlan = (p: unknown): p is PlanId => typeof p === "string" && p in PLANS;
export const isMonths = (m: unknown): m is Months => TERMS.some((t) => t.months === m);

export function planPrice(plan: PlanId, months: Months) {
  const t = TERMS.find((x) => x.months === months)!;
  return Math.round((PLANS[plan].monthlyMinor * months * (1 - t.discount)) / 100) * 100; // whole cedis
}

export const DAYS_PER_MONTH = 30;
export const TOOL_PATH: Record<PlanTool, string> = { stats: "/tools/stats", qual: "/tools/qual", lit: "/tools/lit" };
