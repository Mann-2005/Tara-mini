// Plain domain types for obligation rules.
//
// These mirror the Prisma enums/models structurally (Prisma rows are
// assignable to them) but the domain layer never imports Prisma, so it stays
// pure and testable without a database.

import type { FederalState } from "../calendar/holidays";
import type { IsoDate } from "../calendar/isoDate";

export type VatFilingFrequency = "MONTHLY" | "QUARTERLY" | "NONE";
export type Applicability = "ALWAYS" | "VAT_REGISTERED" | "HAS_PAYROLL";
export type Recurrence = "MONTHLY" | "QUARTERLY" | "ANNUAL" | "FOLLOWS_VAT_FREQUENCY";

/** The client facts that obligation rules depend on. */
export interface ClientProfile {
  id: string;
  fiscalYearEndMonth: number;
  vatFilingFrequency: VatFilingFrequency;
  hasPayroll: boolean;
  hasDauerfristverlaengerung: boolean;
  federalState: FederalState;
}

/** The rule fields of an ObligationType. */
export interface ObligationRule {
  id: string;
  code: string;
  appliesWhen: Applicability;
  recurrence: Recurrence;
  dueMonthsAfterPeriodEnd: number;
  dueDayOfMonth: number;
  dauerfristExtensionMonths: number;
  rollForwardToWorkingDay: boolean;
}

/** One obligation the generator says should exist. */
export interface ObligationSpec {
  clientId: string;
  obligationTypeId: string;
  obligationTypeCode: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
}
