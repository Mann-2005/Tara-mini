// Which obligation could a confirmed document fulfil? Pure and deterministic.
//
// It only SUGGESTS: the reviewer makes the final choice (or links nothing),
// and the server re-checks that the choice is allowed (isLinkAllowed).
// Runs on the server and in the browser (the review form re-computes the
// suggestion live while a reviewer corrects the document type or date).

import type { IsoDate } from "../calendar/isoDate";
import type { DocumentType, ObligationKind, ObligationStatus } from "../obligations/types";

export interface LinkableObligation {
  id: string;
  typeCode: string;
  typeName: string;
  kind: ObligationKind;
  acceptedDocumentTypes: readonly DocumentType[];
  requiresManualCompletion: boolean;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
  status: ObligationStatus;
}

export interface MatchResult {
  /** Obligations this document type may fulfil: OPEN first, then by period (newest first). */
  candidates: LinkableObligation[];
  /** The most likely one, or null if nothing fits clearly. */
  suggestedId: string | null;
}

/** A link is allowed if the obligation accepts this document type and is not waived. */
export function isLinkAllowed(o: Pick<LinkableObligation, "acceptedDocumentTypes" | "status">, documentType: DocumentType): boolean {
  return o.status !== "WAIVED" && o.acceptedDocumentTypes.includes(documentType);
}

export function matchObligations(
  doc: { documentType: DocumentType; documentDate: IsoDate | null },
  obligations: readonly LinkableObligation[],
): MatchResult {
  const candidates = obligations
    .filter((o) => isLinkAllowed(o, doc.documentType))
    .sort(
      (a, b) =>
        Number(a.status !== "OPEN") - Number(b.status !== "OPEN") ||
        (a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0) ||
        a.typeCode.localeCompare(b.typeCode) ||
        a.id.localeCompare(b.id),
    );

  return { candidates, suggestedId: suggest(doc, candidates) };
}

function suggest(doc: { documentDate: IsoDate | null }, candidates: LinkableObligation[]): string | null {
  const date = doc.documentDate;
  if (!date) return null;
  const open = candidates.filter((o) => o.status === "OPEN");

  // Client deliveries (invoices, statements, payroll data): the period that contains the document date.
  const containing = open.filter((o) => o.kind === "CLIENT_DELIVERY" && o.periodStart <= date && date <= o.periodEnd);
  if (containing.length === 1) return containing[0].id;

  // Filings (ELSTER receipt): transmitted AFTER the period ends, so take the latest
  // open period that ended before the transmission date.
  // ASSUMPTION: a filing receipt belongs to the most recent unfiled period.
  const filings = open.filter((o) => o.kind === "FIRM_FILING" && o.periodEnd < date);
  if (filings.length > 0) return filings[0].id; // candidates are sorted newest period first

  return null;
}
