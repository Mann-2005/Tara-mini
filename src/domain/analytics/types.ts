// Inputs shared by the V2 analytics engines. Plain data, no Prisma: loaders in
// src/server/analytics/ (step 2) map database rows onto these shapes.

import type { IsoDate } from "../calendar/isoDate";
import type { DocumentType } from "../obligations/types";

/**
 * One document as the analytics see it.
 * - CONFIRMED: fields of the human-confirmed classification (the truth).
 * - PROPOSED:  fields of the model's (unreviewed) proposal. Only used where a
 *              proposal is evidence enough, e.g. "this month's invoice has arrived".
 * Rejected and unclassified documents are never passed in.
 */
export interface AnalyticsDocument {
  documentId: string;
  clientId: string;
  status: "CONFIRMED" | "PROPOSED";
  documentType: DocumentType;
  documentDate: IsoDate | null;
  /** Gross amount as an exact 2-decimal string ("8925.00"), or null if not stated. */
  amount: string | null;
  /** VAT amount as an exact 2-decimal string, or null if not stated. */
  vatAmount: string | null;
  currency: string;
  counterparty: string | null;
}

/** A calendar period, both ends inclusive. */
export interface Period {
  start: IsoDate;
  end: IsoDate;
}
