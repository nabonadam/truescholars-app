/** Money helpers. All amounts are integer minor units (pesewas for GHS: 100 pesewas = GH₵1). */

export function assertMinor(amountMinor: number, label = "amount"): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(`${label} must be a positive whole number of minor units, got ${amountMinor}`);
  }
}

/** Platform fee for an amount, rounded to the nearest pesewa. */
export function feeFor(amountMinor: number, feeBps: number): number {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error(`feeBps must be between 0 and 10000, got ${feeBps}`);
  }
  return Math.round((amountMinor * feeBps) / 10_000);
}

export function formatMoney(amountMinor: number, currency = "GHS"): string {
  const major = amountMinor / 100;
  const symbol = currency === "GHS" ? "GH₵" : `${currency} `;
  return `${symbol}${major.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function toMinor(major: number): number {
  return Math.round(major * 100);
}
