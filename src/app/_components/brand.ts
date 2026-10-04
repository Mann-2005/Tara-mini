// Brand configuration: the one place to change names and the logo.
//
// To use the real logo: put the file in /public/brand/ (SVG preferred, about
// 32px tall) and set `logoSrc`, e.g. "/brand/tara-logo.svg". Until then the
// nav shows a labelled placeholder of the same size.
// Use the firm's official logo file, with their permission.

export const BRAND = {
  firmName: "TARA",
  productName: "Tara Mini",
  /** Path under /public, or null for the placeholder. */
  logoSrc: null as string | null,
  /** Logo box in the nav, matching the wordmark on taratax.ai (142×32). */
  logoWidth: 142,
  logoHeight: 32,
};
