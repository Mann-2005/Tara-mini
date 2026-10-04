// Client insights: the three V2 engines composed for one client. Pure.
//
// Decides WHICH periods the engines look at, so the dashboard (step 3) only
// renders results:
// - Compliance Score: all of the client's obligations (the engine filters).
// - VAT forecast: the client's next VAT return to file — the earliest OPEN
//   firm filing that is fulfilled by an ELSTER receipt and whose period has
//   started by the as-of date. Mid-period this is a running total; after the
//   period ends it is the estimate before filing. None for VAT-exempt clients.
// - Ghost invoices: every OPEN client delivery that collects incoming invoices
//   (e.g. Eingangsrechnungen) and has started — i.e. "before the period is closed".

import type { IsoDate } from "../calendar/isoDate";
import type { DocumentType, VatFilingFrequency } from "../obligations/types";
import { computeClientScore, type ClientScore, type ScoreObligation } from "./clientScore";
import { compareText } from "./compare";
import { detectGhostInvoices, type GhostInvoice } from "./ghostInvoices";
import type { AnalyticsDocument } from "./types";
import { computeRunningVatLiability, type VatLiability } from "./vatLiability";

export interface InsightObligation extends ScoreObligation {
  typeCode: string;
  typeName: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  acceptedDocumentTypes: readonly DocumentType[];
}

export interface InsightsInput {
  client: { id: string; vatFilingFrequency: VatFilingFrequency };
  asOf: IsoDate;
  /** Confirmed and proposed documents known by the as-of date. */
  documents: readonly AnalyticsDocument[];
  obligations: readonly InsightObligation[];
}

export interface VatForecast extends VatLiability {
  obligationId: string;
  typeName: string;
  dueDate: IsoDate;
}

export interface GhostCheck {
  obligationId: string;
  typeName: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
  vendors: GhostInvoice[];
}

export interface ClientInsights {
  clientId: string;
  score: ClientScore;
  vat: VatForecast | null;
  /** Only periods with at least one expected-but-missing vendor, earliest first. */
  ghosts: GhostCheck[];
}

const byDueThenPeriodThenId = (a: InsightObligation, b: InsightObligation) =>
  compareText(a.dueDate, b.dueDate) || compareText(a.periodStart, b.periodStart) || compareText(a.id, b.id);

/** The next VAT return to file, or null. */
export function selectVatObligation(obligations: readonly InsightObligation[], asOf: IsoDate): InsightObligation | null {
  const candidates = obligations
    .filter((o) => o.kind === "FIRM_FILING" && o.acceptedDocumentTypes.includes("ELSTER_RECEIPT") && o.status === "OPEN" && o.periodStart <= asOf)
    .sort(byDueThenPeriodThenId);
  return candidates[0] ?? null;
}

export function computeClientInsights(input: InsightsInput): ClientInsights {
  const { client, asOf, documents, obligations } = input;

  const vatObligation = client.vatFilingFrequency === "NONE" ? null : selectVatObligation(obligations, asOf);
  const vat: VatForecast | null = vatObligation && {
    ...computeRunningVatLiability(documents, { start: vatObligation.periodStart, end: vatObligation.periodEnd }, asOf),
    obligationId: vatObligation.id,
    typeName: vatObligation.typeName,
    dueDate: vatObligation.dueDate,
  };

  const ghosts: GhostCheck[] = obligations
    .filter((o) => o.kind === "CLIENT_DELIVERY" && o.status === "OPEN" && o.acceptedDocumentTypes.includes("INCOMING_INVOICE") && o.periodStart <= asOf)
    .sort(byDueThenPeriodThenId)
    .map((o) => ({
      obligationId: o.id,
      typeName: o.typeName,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      dueDate: o.dueDate,
      vendors: detectGhostInvoices(client.id, o.periodStart, documents),
    }))
    .filter((g) => g.vendors.length > 0);

  return {
    clientId: client.id,
    score: computeClientScore(client, obligations, asOf),
    vat,
    ghosts,
  };
}
