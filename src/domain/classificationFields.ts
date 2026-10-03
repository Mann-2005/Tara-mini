// The reviewable fields of a classification, in one normalised shape.
// Shared by review (confirm vs correct) and accuracy measurement, so
// "the model got this field wrong" means exactly the same thing in both.

import type { IsoDate } from "./calendar/isoDate";
import type { DocumentType } from "./obligations/types";

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

/** The fields whose values differ. Empty array = identical. */
export function changedFields(a: ClassificationFields, b: ClassificationFields): FieldName[] {
  return FIELD_NAMES.filter((k) => a[k] !== b[k]);
}
