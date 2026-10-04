// Eigenbeleg (self-issued substitute voucher). Pure: validation and voucher content.
//
// German practice allows a business expense without its original receipt if
// a substitute voucher records what an original would have shown. Content
// follows common practice (GoBD: verifiable, complete, signed):
//   payee, date, amount, what was bought, why the original is missing,
//   the business purpose, issue date and signature of the person who paid.
//
// VAT: an Eigenbeleg is not an invoice under §14 UStG, so NO input VAT may
// be deducted (§15 Abs. 1 Nr. 1 UStG). The full gross amount is booked as
// the expense and the voucher's VAT is always 0,00.
//
// ASSUMPTIONS (verify):
// - There is no statutory amount limit. Tax offices mainly accept Eigenbelege
//   for small amounts; above 250 EUR (the Kleinbetragsrechnung limit, §33
//   UStDV) this module WARNS that a duplicate invoice should be requested
//   first. It does not block.
// - The expense must fall inside the period of the obligation it is drafted
//   for, so the deterministic matcher links it to that obligation at review.

import { parseIsoDate, type IsoDate } from "../calendar/isoDate";
import { centsToDecimal, toCents } from "../money";

export const MISSING_REASONS = {
  LOST: "Originalbeleg verloren gegangen",
  NO_RECEIPT_ISSUED: "Kein Beleg erhältlich (z. B. Automat, Parkuhr, Trinkgeld)",
  ILLEGIBLE: "Originalbeleg unleserlich",
  OTHER: "Sonstiger Grund",
} as const;

export type MissingReason = keyof typeof MISSING_REASONS;

/** Above this gross amount the voucher still works, but a duplicate invoice should be requested first. */
export const SMALL_AMOUNT_LIMIT_CENTS = 25_000;

export interface EigenbelegInput {
  client: { name: string; clientNumber: string };
  /** The obligation (period) the expense belongs to. */
  period: { start: IsoDate; end: IsoDate; label: string };
  expenseDate: IsoDate;
  payee: string;
  description: string;
  /** Gross amount actually paid, exact 2-decimal string ("47.60"). */
  grossAmount: string;
  reason: MissingReason;
  reasonDetail: string;
  businessPurpose: string;
  /** Name of the client representative who confirmed the details digitally, or null for a wet signature. */
  digitallyConfirmedBy: string | null;
  createdBy: string;
  createdOn: IsoDate;
}

export type EigenbelegField = "expenseDate" | "payee" | "description" | "grossAmount" | "reason" | "reasonDetail" | "businessPurpose" | "digitallyConfirmedBy";

export interface EigenbelegCheck {
  errors: Partial<Record<EigenbelegField, string>>;
  warnings: string[];
}

function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function checkEigenbeleg(input: EigenbelegInput): EigenbelegCheck {
  const errors: EigenbelegCheck["errors"] = {};
  const warnings: string[] = [];

  if (!isIsoDate(input.expenseDate)) errors.expenseDate = "Enter the date of the expense.";
  else if (input.expenseDate > input.createdOn) errors.expenseDate = "The expense date cannot be in the future.";
  else if (input.expenseDate < input.period.start || input.expenseDate > input.period.end)
    errors.expenseDate = `The expense must fall within ${input.period.label}.`;

  if (input.payee.trim().length < 2) errors.payee = "Enter who was paid (vendor or person).";
  if (input.description.trim().length < 3) errors.description = "Describe what was bought or paid for.";

  let cents: number | null = null;
  try {
    cents = toCents(input.grossAmount);
  } catch {
    errors.grossAmount = "Enter the amount paid, e.g. 47.60.";
  }
  if (cents !== null && cents <= 0) errors.grossAmount = "The amount must be greater than zero.";
  else if (cents !== null && cents > SMALL_AMOUNT_LIMIT_CENTS)
    warnings.push(
      "Over 250 EUR: tax offices accept Eigenbelege mainly for small amounts. Ask the vendor for a duplicate invoice first if at all possible.",
    );

  if (!(input.reason in MISSING_REASONS)) errors.reason = "Choose why the original receipt is missing.";
  else if (input.reason === "OTHER" && input.reasonDetail.trim().length < 5) errors.reasonDetail = "Explain why the original receipt is missing.";

  if (input.businessPurpose.trim().length < 10) errors.businessPurpose = "Explain the business purpose (betrieblicher Anlass) in a sentence.";
  if (input.digitallyConfirmedBy !== null && input.digitallyConfirmedBy.trim().length < 2)
    errors.digitallyConfirmedBy = "Enter who confirmed the details.";

  return { errors, warnings };
}

const germanDate = (d: IsoDate) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** "1.234,50 EUR" from an exact amount string. */
export function germanMoney(amount: string): string {
  const [units, fraction] = centsToDecimal(toCents(amount)).split(".");
  const negative = units.startsWith("-");
  const digits = negative ? units.slice(1) : units;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${fraction} EUR`;
}

export interface Voucher {
  title: string;
  number: string;
  /** Label / value pairs, in print order. */
  fields: [string, string][];
  vatNote: string;
  declaration: string;
  signature: { mode: "DIGITAL"; confirmedBy: string } | { mode: "WET" };
  footer: string;
}

/** The voucher's content (German: it is an accounting record). Call only after checkEigenbeleg passed. */
export function buildVoucher(input: EigenbelegInput, number: string): Voucher {
  const amount = germanMoney(input.grossAmount);
  const reason = input.reason === "OTHER" ? input.reasonDetail.trim() : `${MISSING_REASONS[input.reason]}${input.reasonDetail.trim() ? ` – ${input.reasonDetail.trim()}` : ""}`;
  return {
    title: "Eigenbeleg (Ersatzbeleg)",
    number,
    fields: [
      ["Mandant", `${input.client.name} (Nr. ${input.client.clientNumber})`],
      ["Datum der Ausgabe", germanDate(input.expenseDate)],
      ["Zahlungsempfänger", input.payee.trim()],
      ["Gegenstand / Leistung", input.description.trim()],
      ["Betrag (brutto, bezahlt)", amount],
      ["Davon Vorsteuer", "0,00 EUR"],
      ["Als Betriebsausgabe zu buchen", amount],
      ["Grund für fehlenden Originalbeleg", reason],
      ["Betrieblicher Anlass", input.businessPurpose.trim()],
      ["Zuordnung", input.period.label],
    ],
    vatNote:
      "Kein Vorsteuerabzug: Ein Eigenbeleg ist keine Rechnung im Sinne des § 14 UStG. " +
      "Die Vorsteuer ist daher nicht abziehbar (§ 15 Abs. 1 Nr. 1 UStG); der Bruttobetrag wird als Betriebsausgabe erfasst.",
    declaration:
      "Ich versichere, dass die obige Ausgabe in der angegebenen Höhe betrieblich veranlasst war " +
      "und ein Originalbeleg nicht vorliegt bzw. nicht beschafft werden konnte.",
    signature: input.digitallyConfirmedBy !== null ? { mode: "DIGITAL", confirmedBy: input.digitallyConfirmedBy.trim() } : { mode: "WET" },
    footer: `Erstellt am ${germanDate(input.createdOn)} von ${input.createdBy}. Unveränderbar gespeichert (SHA-256), GoBD-konform archiviert.`,
  };
}

/** Plain-text rendering, stored as the document's searchable text. */
export function voucherText(v: Voucher): string {
  const signature =
    v.signature.mode === "DIGITAL"
      ? `Digital bestätigt durch: ${v.signature.confirmedBy}`
      : "Unterschrift des Zahlenden: ______________________________";
  return [`${v.title}  Nr. ${v.number}`, "", ...v.fields.map(([k, val]) => `${k}: ${val}`), "", v.vatNote, "", v.declaration, signature, "", v.footer].join("\n");
}
