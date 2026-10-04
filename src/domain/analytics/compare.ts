// Deterministic ordering helper for sort tie-breakers.
// Plain code-unit comparison (not localeCompare), so results never depend on
// the runtime's locale data.

export function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
