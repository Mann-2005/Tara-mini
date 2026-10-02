// Obligation generator. Pure: same inputs → same specs, in the same order.
//
// Given a client profile, the obligation rules and a window of months, it
// returns every obligation period whose END month falls inside the window.
// ("Periods ending in the window" means a quarterly filer always gets its
// quarter once the quarter's last month is in range.)
//
// Persisting the specs (idempotently) is done elsewhere, in
// src/server/obligations/syncObligations.ts.

import { addMonths, daysInMonth, parseIsoMonth, toIsoDate, toIsoMonth, type IsoMonth } from "../calendar/isoDate";
import { computeDueDate } from "./dueDate";
import type { ClientProfile, ObligationRule, ObligationSpec } from "./types";

/** Does this rule apply to this client at all? */
export function appliesTo(rule: Pick<ObligationRule, "appliesWhen">, client: ClientProfile): boolean {
  switch (rule.appliesWhen) {
    case "ALWAYS":
      return true;
    case "VAT_REGISTERED":
      return client.vatFilingFrequency !== "NONE";
    case "HAS_PAYROLL":
      return client.hasPayroll;
  }
}

/** Length in months of one period for this client, or null if not applicable. */
export function periodLengthMonths(rule: Pick<ObligationRule, "recurrence">, client: ClientProfile): number | null {
  switch (rule.recurrence) {
    case "MONTHLY":
      return 1;
    case "QUARTERLY":
      return 3;
    case "ANNUAL":
      return 12;
    case "FOLLOWS_VAT_FREQUENCY":
      if (client.vatFilingFrequency === "MONTHLY") return 1;
      if (client.vatFilingFrequency === "QUARTERLY") return 3;
      return null; // no advance VAT returns
  }
}

/**
 * Is `month` (1–12) the last month of a period?
 * - Quarters are CALENDAR quarters (Mar/Jun/Sep/Dec).
 *   ASSUMPTION: correct for UStVA, which always follows the calendar year
 *   (§16 Abs. 1 UStG, §18 Abs. 2 UStG) regardless of the fiscal year.
 * - Annual periods end in the client's fiscal-year-end month.
 */
function isPeriodEndMonth(month: number, lengthMonths: number, client: ClientProfile, recurrence: ObligationRule["recurrence"]): boolean {
  if (lengthMonths === 1) return true;
  if (lengthMonths === 3) return month % 3 === 0;
  if (recurrence === "ANNUAL") return month === client.fiscalYearEndMonth;
  return false;
}

/** All obligation specs whose period ends within [fromMonth, toMonth] (inclusive). */
export function generateObligations(
  client: ClientProfile,
  rules: readonly ObligationRule[],
  fromMonth: IsoMonth,
  toMonth: IsoMonth,
): ObligationSpec[] {
  const from = parseIsoMonth(fromMonth);
  const to = parseIsoMonth(toMonth);
  const specs: ObligationSpec[] = [];

  // Sort rules by code so output order never depends on input order.
  const sortedRules = [...rules].sort((a, b) => a.code.localeCompare(b.code));

  for (let ym = from; ym.year * 12 + ym.month <= to.year * 12 + to.month; ym = addMonths(ym.year, ym.month, 1)) {
    for (const rule of sortedRules) {
      if (!appliesTo(rule, client)) continue;
      const length = periodLengthMonths(rule, client);
      if (length === null) continue;
      if (!isPeriodEndMonth(ym.month, length, client, rule.recurrence)) continue;

      const start = addMonths(ym.year, ym.month, -(length - 1));
      const periodStart = toIsoDate(start.year, start.month, 1);
      const periodEnd = toIsoDate(ym.year, ym.month, daysInMonth(ym.year, ym.month));

      specs.push({
        clientId: client.id,
        obligationTypeId: rule.id,
        obligationTypeCode: rule.code,
        periodStart,
        periodEnd,
        dueDate: computeDueDate(rule, client, periodEnd),
      });
    }
  }
  return specs;
}

/** The window "last N full months before asOf", as [fromMonth, toMonth]. */
export function lastFullMonths(asOf: string, n: number): [IsoMonth, IsoMonth] {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const last = addMonths(year, month, -1);
  const first = addMonths(year, month, -n);
  return [toIsoMonth(first.year, first.month), toIsoMonth(last.year, last.month)];
}
