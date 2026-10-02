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
