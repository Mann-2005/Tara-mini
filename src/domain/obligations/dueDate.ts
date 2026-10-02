// Due-date rule interpreter. Pure function of (rule, client, periodEnd).
//
// Rule: take the month in which the period ends, move forward
// `dueMonthsAfterPeriodEnd` months (plus `dauerfristExtensionMonths` if the
// client has Dauerfristverlängerung), take day `dueDayOfMonth` of that month,
// then — if enabled — roll forward to the next working day.
//
// Example (Umsatzsteuervoranmeldung, §18 Abs. 1 UStG; §§46–48 UStDV):
//   period July 2026, monthly filer       → 10 Aug 2026
//   same, with Dauerfristverlängerung     → 10 Sep 2026
//   period Sep 2026 → 10 Oct 2026 is a Saturday → Monday 12 Oct 2026

import { addMonths, daysInMonth, parseIsoDate, toIsoDate, type IsoDate } from "../calendar/isoDate";
import { nextWorkingDay } from "../calendar/workingDays";
import type { ClientProfile, ObligationRule } from "./types";

export function computeDueDate(
  rule: Pick<ObligationRule, "dueMonthsAfterPeriodEnd" | "dueDayOfMonth" | "dauerfristExtensionMonths" | "rollForwardToWorkingDay">,
  client: Pick<ClientProfile, "hasDauerfristverlaengerung" | "federalState">,
  periodEnd: IsoDate,
): IsoDate {
  const end = parseIsoDate(periodEnd);
  const extension = client.hasDauerfristverlaengerung ? rule.dauerfristExtensionMonths : 0;
  const target = addMonths(end.year, end.month, rule.dueMonthsAfterPeriodEnd + extension);

  // Clamp e.g. "day 31" to the last day of shorter months.
  const day = Math.min(rule.dueDayOfMonth, daysInMonth(target.year, target.month));
  const base = toIsoDate(target.year, target.month, day);

  return rule.rollForwardToWorkingDay ? nextWorkingDay(base, client.federalState) : base;
}
