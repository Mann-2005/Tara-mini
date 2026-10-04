// Deterministic vendor-name normalisation, so "Telefónica Germany GmbH & Co. OHG"
// and "Telefonica Germany" are recognised as the same counterparty.
//
// LIMITATION: no alias table — brand names that differ from the legal name
// (e.g. "O2" vs "Telefónica Germany") are treated as different vendors.

/** Legal-form and filler tokens dropped from names (compared after normalisation). */
const NOISE_TOKENS = new Set([
  "gmbh",
  "mbh",
  "ag",
  "ug",
  "haftungsbeschraenkt",
  "kg",
  "kgaa",
  "ohg",
  "co",
  "ek",
  "ev",
  "se",
  "gbr",
  "ltd",
  "inc",
  "llc",
]);

/** Normalised grouping key; empty string if nothing meaningful remains. */
export function vendorKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // remaining diacritics (é → e, ó → o)
    .replace(/\./g, "") // dotted abbreviations collapse: "e.K." → "ek", "Co." → "co"
    .replace(/[^a-z0-9]+/g, " ") // other punctuation, "&" → spaces
    .split(" ")
    .filter((token) => token !== "" && !NOISE_TOKENS.has(token))
    .join(" ");
}
