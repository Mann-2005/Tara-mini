// The strict contract between the LLM and the rest of the system.
//
// Whatever the model returns is parsed against this Zod schema; anything that
// does not fit (unknown document type, malformed date, extra fields…) is
// rejected, and the document stays PENDING. Even a valid result is only a
// PROPOSAL: it is stored as an unconfirmed DocumentClassification and counts
// for nothing until a human confirms it (step 6).

import { z } from "zod";
import { parseIsoDate } from "@/domain/calendar/isoDate";
import { DOCUMENT_TYPES } from "@/domain/obligations/types";

export { DOCUMENT_TYPES };

function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

// Note: refinements (date validity, currency format) are checked when parsing
// the model's answer; they are not sent to Gemini, whose schema dialect only
// supports a subset of JSON Schema.
export const documentProposalSchema = z.strictObject({
  documentType: z.enum(DOCUMENT_TYPES).describe(
    "INCOMING_INVOICE = Eingangsrechnung (an invoice the client received from a supplier); " +
      "OUTGOING_INVOICE = Ausgangsrechnung (an invoice the client issued); " +
      "RECEIPT = Quittung/Kassenbon; BANK_STATEMENT = Kontoauszug; " +
      "PAYROLL_DATA = Lohndaten (hours, absences, payroll input); " +
      "ELSTER_RECEIPT = ELSTER Übermittlungsprotokoll (proof a tax return was transmitted); " +
      "OTHER = anything else.",
  ),
  documentDate: z
    .string()
    .refine(isIsoDate, "must be a valid YYYY-MM-DD date")
    .nullable()
    .describe(
      "The document's own date as YYYY-MM-DD: the Rechnungsdatum for invoices, the last day of the statement period " +
        "for bank statements, the transmission date for ELSTER receipts. null if not stated.",
    ),
  amount: z
    .number()
    .nullable()
    .describe("Total GROSS amount (brutto, incl. VAT) as a plain number, e.g. 1428.00. null if there is no single total."),
  vatAmount: z
    .number()
    .nullable()
    .describe("Total VAT (Umsatzsteuer / MwSt) amount as a plain number. 0 if explicitly VAT-free. null if not stated."),
  currency: z
    .string()
    .refine((c) => /^[A-Z]{3}$/.test(c), "must be an ISO 4217 code like EUR")
    .describe("ISO 4217 currency code, e.g. EUR."),
  counterparty: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .describe(
      "The OTHER party, never the client itself: the issuer of an incoming invoice or receipt, the customer of an " +
        "outgoing invoice, the bank for a bank statement, the Finanzamt for an ELSTER receipt. null if unclear.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Your confidence in this classification as a whole, from 0 to 1."),
});

export type DocumentProposal = z.infer<typeof documentProposalSchema>;

/** Used when the file has no text layer (image or scanned PDF): the model also transcribes it. */
export const documentProposalWithTextSchema = documentProposalSchema.extend({
  transcribedText: z
    .string()
    .max(20_000)
    .describe("A faithful plain-text transcription of the document's visible text, in reading order."),
});
