// Display names for enum values.

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  INCOMING_INVOICE: "Incoming invoice (Eingangsrechnung)",
  OUTGOING_INVOICE: "Outgoing invoice (Ausgangsrechnung)",
  RECEIPT: "Receipt (Beleg)",
  BANK_STATEMENT: "Bank statement (Kontoauszug)",
  PAYROLL_DATA: "Payroll data (Lohndaten)",
  ELSTER_RECEIPT: "ELSTER receipt (Übermittlungsprotokoll)",
  OTHER: "Other",
};

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Not classified",
  PROPOSED: "Awaiting review",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
};

/** "1.428,00 EUR": German formatting, since the documents are German. */
export function formatMoney(value: string | number | null, currency = "EUR"): string {
  if (value === null) return "–";
  return `${Number(value).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
