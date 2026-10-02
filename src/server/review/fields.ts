// The reviewable fields of a classification, in one normalised shape, so an
// LLM proposal and a reviewer's answer can be compared exactly.
// "Confirm" vs "Correct" is decided by this comparison, not by which button
// was pressed: if nothing differs, it is a confirmation of the LLM row.

import { z } from "zod";
import { parseMoney } from "@/domain/money";
import { DOCUMENT_TYPES, type DocumentType } from "@/domain/obligations/types";
import { dbToIsoDate, parseIsoDate, type IsoDate } from "@/domain/calendar/isoDate";

export { parseMoney };

export interface ClassificationFields {
  documentType: DocumentType;
  documentDate: IsoDate | null;
  /** Exact 2-decimal string, e.g. "8925.00". */
  amount: string | null;
  vatAmount: string | null;
  currency: string;
  counterparty: string | null;
}

export const FIELD_NAMES = ["documentType", "documentDate", "amount", "vatAmount", "currency", "counterparty"] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/** Normalise a stored classification row. */
export function fieldsFromRow(row: {
  documentType: DocumentType;
  documentDate: Date | null;
  amount: { toFixed(digits: number): string } | null;
  vatAmount: { toFixed(digits: number): string } | null;
  currency: string;
  counterparty: string | null;
}): ClassificationFields {
  return {
    documentType: row.documentType,
    documentDate: row.documentDate ? dbToIsoDate(row.documentDate) : null,
    amount: row.amount ? row.amount.toFixed(2) : null,
    vatAmount: row.vatAmount ? row.vatAmount.toFixed(2) : null,
    currency: row.currency,
    counterparty: row.counterparty,
  };
}

const formSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES, { message: "Choose a document type." }),
  documentDate: z.string().trim(),
  amount: z.string(),
  vatAmount: z.string(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as EUR."),
  counterparty: z.string().trim().max(200, "Keep the counterparty under 200 characters."),
});

export type ParseResult =
  | { ok: true; fields: ClassificationFields }
  | { ok: false; errors: Partial<Record<FieldName, string>> };

/** Validates the reviewer's form input. */
export function parseReviewedFields(input: Record<string, unknown>): ParseResult {
  const raw = Object.fromEntries(FIELD_NAMES.map((k) => [k, typeof input[k] === "string" ? input[k] : ""]));
  const parsed = formSchema.safeParse(raw);
  const errors: Partial<Record<FieldName, string>> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[issue.path[0] as FieldName] ??= issue.message;
    return { ok: false, errors };
  }
  const v = parsed.data;

  let documentDate: IsoDate | null = null;
  if (v.documentDate) {
    try {
      parseIsoDate(v.documentDate);
      documentDate = v.documentDate;
    } catch {
      errors.documentDate = "Enter a valid date.";
    }
  }
  const amount = parseMoney(v.amount);
  if (amount === undefined) errors.amount = "Enter an amount like 1.234,56.";
  const vatAmount = parseMoney(v.vatAmount);
  if (vatAmount === undefined) errors.vatAmount = "Enter an amount like 234,56.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      documentType: v.documentType,
      documentDate,
      amount: amount ?? null,
      vatAmount: vatAmount ?? null,
      currency: v.currency,
      counterparty: v.counterparty === "" ? null : v.counterparty,
    },
  };
}

/** The fields whose values differ. Empty array = identical. */
export function changedFields(a: ClassificationFields, b: ClassificationFields): FieldName[] {
  return FIELD_NAMES.filter((k) => a[k] !== b[k]);
}
