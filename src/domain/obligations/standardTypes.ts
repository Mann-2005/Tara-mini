// The firm's standard obligation types, as plain data.
// Single source of truth: the seed writes these to the database, and the
// unit tests use them, so tests exercise exactly the rules the app runs on.
//
// ASSUMPTIONS about German practice are marked ⚠ — please verify.

import type { DocumentType, ObligationKind, ObligationRule } from "./types";

export interface StandardObligationType extends Omit<ObligationRule, "id"> {
  name: string;
  description: string;
  kind: ObligationKind;
  acceptedDocumentTypes: DocumentType[];
  minDocuments: number;
  requiresManualCompletion: boolean;
}

export const STANDARD_OBLIGATION_TYPES: StandardObligationType[] = [
  {
    code: "USTVA",
    name: "Umsatzsteuervoranmeldung",
    description:
      "Advance VAT return, filed by the firm via ELSTER. Due on the 10th day after the end of the period " +
      "(§18 Abs. 1 UStG); one month later with Dauerfristverlängerung (§§46–48 UStDV). Fulfilled by uploading " +
      "the ELSTER Übermittlungsprotokoll.",
    kind: "FIRM_FILING",
    appliesWhen: "VAT_REGISTERED",
    recurrence: "FOLLOWS_VAT_FREQUENCY",
    dueMonthsAfterPeriodEnd: 1,
    dueDayOfMonth: 10,
    dauerfristExtensionMonths: 1,
    rollForwardToWorkingDay: true, // §108 Abs. 3 AO
    acceptedDocumentTypes: ["ELSTER_RECEIPT"],
    minDocuments: 1,
    requiresManualCompletion: false,
  },
  {
    code: "KONTOAUSZUEGE",
    name: "Kontoauszüge",
    description:
      "Monthly bank statements from the client. ⚠ Firm-internal deadline: 5th of the following month, " +
      "shifted one month with Dauerfristverlängerung (so the firm still has time before the UStVA).",
    kind: "CLIENT_DELIVERY",
    appliesWhen: "ALWAYS",
    recurrence: "MONTHLY", // ⚠ monthly for every client, even quarterly VAT filers
    dueMonthsAfterPeriodEnd: 1,
    dueDayOfMonth: 5, // ⚠ firm-internal choice
    dauerfristExtensionMonths: 1, // ⚠ follows the UStVA extension
    rollForwardToWorkingDay: true, // ⚠ §108 AO applied to an internal deadline (a choice, not law)
    acceptedDocumentTypes: ["BANK_STATEMENT"],
    minDocuments: 1,
    requiresManualCompletion: false,
  },
  {
    code: "EINGANGSRECHNUNGEN",
    name: "Eingangsrechnungen",
    description:
      "Incoming invoices and receipts for the month. Many documents per period: at least one must arrive, " +
      "then staff closes the period once complete. ⚠ Same internal deadline as Kontoauszüge.",
    kind: "CLIENT_DELIVERY",
    appliesWhen: "ALWAYS",
    recurrence: "MONTHLY", // ⚠
    dueMonthsAfterPeriodEnd: 1,
    dueDayOfMonth: 5, // ⚠
    dauerfristExtensionMonths: 1, // ⚠
    rollForwardToWorkingDay: true, // ⚠
    acceptedDocumentTypes: ["INCOMING_INVOICE", "RECEIPT"],
    minDocuments: 1,
    requiresManualCompletion: true,
  },
  {
    code: "LOHN",
    name: "Lohnabrechnung (Lohndaten)",
    description:
      "Monthly payroll input (hours, absences, changes) from the client. ⚠ Due the 15th of the SAME month, so " +
      "payroll can run before social-security contributions fall due (third-last banking day, §23 SGB IV). " +
      "⚠ Not affected by Dauerfristverlängerung (that applies to VAT only).",
    kind: "CLIENT_DELIVERY",
    appliesWhen: "HAS_PAYROLL",
    recurrence: "MONTHLY",
    dueMonthsAfterPeriodEnd: 0, // ⚠ same month
    dueDayOfMonth: 15, // ⚠
    dauerfristExtensionMonths: 0,
    rollForwardToWorkingDay: true,
    acceptedDocumentTypes: ["PAYROLL_DATA"],
    minDocuments: 1,
    requiresManualCompletion: false,
  },
];
