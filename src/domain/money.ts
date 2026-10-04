// Money input parsing, shared by the server (validation) and the review form
// (live "changed" detection). Dependency-free so it can ship to the browser.

/**
 * Parses a money input. Accepts German ("8.925,00") and plain ("8925.00")
 * notation. Returns a 2-decimal string, null for empty input ("not stated"),
 * or undefined if the input is not a valid amount.
 */
export function parseMoney(input: string): string | null | undefined {
  const s = input.trim().replace(/\s|€|EUR/gi, "");
  if (s === "") return null;
  const normalised = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalised)) return undefined;
  return Number(normalised).toFixed(2);
}

/**
 * Exact conversion of a decimal money string ("8925.00", "-12.5", "91") to
 * integer cents. Parses the digits directly, never via floating point, so
 * sums of many amounts stay exact. Throws on anything that is not a plain
 * decimal with at most two fraction digits.
 */
export function toCents(amount: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) throw new Error(`Not a decimal money amount: "${amount}"`);
  const [, sign, units, fraction = ""] = match;
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}

/** Integer cents back to a 2-decimal string: 892500 → "8925.00", -1250 → "-12.50". */
export function centsToDecimal(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`Cents must be an integer: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
