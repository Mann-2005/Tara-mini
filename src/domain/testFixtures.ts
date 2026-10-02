// Shared test fixtures: the real standard rules plus client profiles that
// mirror the seed data. Test-only; imported by *.test.ts files.

import { STANDARD_OBLIGATION_TYPES } from "./obligations/standardTypes";
import type { ClientProfile, ObligationRule } from "./obligations/types";

/** Standard rules with id = code, so specs are easy to read in assertions. */
export const RULES: ObligationRule[] = STANDARD_OBLIGATION_TYPES.map((t) => ({ ...t, id: t.code }));

export function rule(code: string): ObligationRule {
  const r = RULES.find((x) => x.code === code);
  if (!r) throw new Error(`Unknown rule ${code}`);
  return r;
}

export function standardType(code: string) {
  const t = STANDARD_OBLIGATION_TYPES.find((x) => x.code === code);
  if (!t) throw new Error(`Unknown type ${code}`);
  return t;
}

const base: Omit<ClientProfile, "id"> = {
  fiscalYearEndMonth: 12,
  vatFilingFrequency: "MONTHLY",
  hasPayroll: true,
  hasDauerfristverlaengerung: false,
  federalState: "NW",
};

export function client(overrides: Partial<ClientProfile> = {}): ClientProfile {
  return { id: "c1", ...base, ...overrides };
}

/** Seed-like profiles. */
export const MUELLER = client({ id: "mueller", federalState: "BY" }); // monthly, payroll
export const SCHMIDT = client({ id: "schmidt", federalState: "BE", vatFilingFrequency: "QUARTERLY", hasPayroll: false });
export const WEBER = client({ id: "weber", federalState: "NW", hasDauerfristverlaengerung: true });
export const FISCHER = client({ id: "fischer", federalState: "HH", vatFilingFrequency: "NONE" });
export const BECKER = client({
  id: "becker",
  federalState: "BW",
  vatFilingFrequency: "QUARTERLY",
  hasPayroll: false,
  hasDauerfristverlaengerung: true,
  fiscalYearEndMonth: 6,
});
