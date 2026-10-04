// Running VAT liability (cash-flow early warning). Pure and deterministic.
//
// From human-CONFIRMED documents dated inside the VAT period and on or before
// the as-of date:
//   input VAT  (Vorsteuer, deductible)  = incoming invoices + purchase receipts
//   output VAT (Umsatzsteuer, owed)     = outgoing invoices
//   net = output − input   > 0 → Zahllast (payable)   < 0 → Guthaben (refund)
//
// It is a provisional estimate, not a tax computation. ASSUMPTIONS (verify):
// - Sollversteuerung: VAT follows the invoice date. Istversteuerung (§20 UStG,
//   VAT on payment) is not modelled.
// - Purchase receipts carry deductible input VAT (Kleinbetragsrechnung up to
//   250 EUR, §33 UStDV). Eigenbelege are stored with 0 VAT (no deduction
//   without a proper invoice, §15 UStG), so they add nothing.
// - Not modelled: reverse charge (§13b UStG), intra-EU acquisitions,
//   Sondervorauszahlung (Dauerfristverlängerung), corrections (§17 UStG),
//   non-deductible input VAT (§15 Abs. 2 UStG).
// - Only EUR documents are counted; others are reported, never converted.

import type { IsoDate } from "../calendar/isoDate";
import type { DocumentType } from "../obligations/types";
import { toCents } from "../money";
import type { AnalyticsDocument, Period } from "./types";

export type VatPosition = "PAYABLE" | "REFUND" | "ZERO";

export interface VatLiability {
  period: Period;
  /** Last day counted: the earlier of period end and as-of date. */
  countedUntil: IsoDate;
  /** True once the as-of date has reached the end of the period. */
  periodComplete: boolean;
  /** False if the as-of date is before the period starts (nothing can be counted yet). */
  periodStarted: boolean;
  inputVatCents: number;
  outputVatCents: number;
  /** output − input. Positive = Zahllast, negative = Guthaben. */
  netCents: number;
  position: VatPosition;
  counted: { input: number; output: number };
  /** Relevant documents that could not be included, so the estimate is honest about its gaps. */
  notCounted: { missingVat: number; foreignCurrency: number };
}

const INPUT_TYPES: readonly DocumentType[] = ["INCOMING_INVOICE", "RECEIPT"];
const OUTPUT_TYPES: readonly DocumentType[] = ["OUTGOING_INVOICE"];

export function computeRunningVatLiability(
  confirmedDocuments: readonly AnalyticsDocument[],
  period: Period,
  asOf: IsoDate,
): VatLiability {
  if (period.start > period.end) throw new Error(`Period starts after it ends: ${period.start} > ${period.end}`);

  const countedUntil = asOf < period.end ? asOf : period.end;
  const result: VatLiability = {
    period,
    countedUntil,
    periodComplete: asOf >= period.end,
    periodStarted: asOf >= period.start,
    inputVatCents: 0,
    outputVatCents: 0,
    netCents: 0,
    position: "ZERO",
    counted: { input: 0, output: 0 },
    notCounted: { missingVat: 0, foreignCurrency: 0 },
  };

  for (const doc of confirmedDocuments) {
    if (doc.status !== "CONFIRMED" || !doc.documentDate) continue;
    if (doc.documentDate < period.start || doc.documentDate > countedUntil) continue;

    const side = INPUT_TYPES.includes(doc.documentType) ? "input" : OUTPUT_TYPES.includes(doc.documentType) ? "output" : null;
    if (side === null) continue; // bank statements, payroll data, ELSTER receipts… carry no VAT of their own

    if (doc.currency !== "EUR") {
      result.notCounted.foreignCurrency++;
      continue;
    }
    if (doc.vatAmount === null) {
      result.notCounted.missingVat++;
      continue;
    }

    const cents = toCents(doc.vatAmount);
    if (side === "input") {
      result.inputVatCents += cents;
      result.counted.input++;
    } else {
      result.outputVatCents += cents;
      result.counted.output++;
    }
  }

  result.netCents = result.outputVatCents - result.inputVatCents;
  result.position = result.netCents > 0 ? "PAYABLE" : result.netCents < 0 ? "REFUND" : "ZERO";
  return result;
}
