// The deterministic gap engine: "what is missing, from whom, by when".
//
// computeGaps(input) is a PURE function:
// - no database, no clock (the as-of date is an explicit input), no LLM;
// - the same input always yields deep-equal output, regardless of the
//   order in which clients and obligations are passed in.
//
// The database loader lives in src/server/gaps/loadGapInput.ts; it only
// gathers the facts below. All judgement happens here.

import { daysBetween, type IsoDate } from "../calendar/isoDate";
import type { ObligationKind, ObligationStatus } from "../obligations/types";

// ─── Input ──────────────────────────────────────────────────────────────────

export interface GapClient {
  id: string;
  clientNumber: string;
  name: string;
}

export interface GapObligation {
  id: string;
  clientId: string;
  typeCode: string;
  typeName: string;
  kind: ObligationKind;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
  status: ObligationStatus;
  /** From the ObligationType's fulfilment rule. */
  minDocuments: number;
  requiresManualCompletion: boolean;
  /** Linked documents whose classification a human CONFIRMED (revoked links excluded). */
  confirmedDocumentCount: number;
}

export interface GapInput {
  asOf: IsoDate;
  clients: readonly GapClient[];
  obligations: readonly GapObligation[];
  /**
   * An open obligation due within this many days (inclusive) is "due soon".
   * ASSUMPTION: 7 calendar days is a sensible chasing horizon; firm-configurable.
   */
  dueSoonDays?: number;
}

// ─── Output ─────────────────────────────────────────────────────────────────

/** Where an open obligation stands in time. */
export type Timing = "OVERDUE" | "DUE_SOON" | "UPCOMING";

/** What has arrived so far for an open obligation. */
export type Receipt =
  /** Nothing confirmed yet. */
  | "MISSING"
  /** Some confirmed documents, fewer than minDocuments. */
  | "PARTIAL"
  /** Enough documents confirmed; waiting for staff to close the period. */
  | "AWAITING_CLOSE";

/** Who has to act next. */
export type Owner = "CLIENT" | "FIRM";

export type Rag = "RED" | "AMBER" | "GREEN";

export interface Gap {
  obligationId: string;
  typeCode: string;
  typeName: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  dueDate: IsoDate;
  /** Negative = days overdue. */
  daysUntilDue: number;
  timing: Timing;
  receipt: Receipt;
  owner: Owner;
  confirmedDocumentCount: number;
  minDocuments: number;
  severity: Rag;
}

export interface ClientGaps {
  clientId: string;
  clientNumber: string;
  name: string;
  rag: Rag;
  /** Sorted most urgent first. */
  gaps: Gap[];
  counts: { overdue: number; dueSoon: number; upcoming: number; closed: number };
}

export interface GapReport {
  asOf: IsoDate;
  dueSoonDays: number;
  /** Sorted most urgent first. */
  clients: ClientGaps[];
}

export const DEFAULT_DUE_SOON_DAYS = 7;

// ─── Rules ──────────────────────────────────────────────────────────────────

export function classifyTiming(asOf: IsoDate, dueDate: IsoDate, dueSoonDays: number): Timing {
  const days = daysBetween(asOf, dueDate);
  // Due today is NOT overdue: the deadline runs until the end of the day.
  if (days < 0) return "OVERDUE";
  if (days <= dueSoonDays) return "DUE_SOON";
  return "UPCOMING";
}

export function classifyReceipt(o: Pick<GapObligation, "confirmedDocumentCount" | "minDocuments">): Receipt {
  if (o.confirmedDocumentCount === 0) return "MISSING";
  if (o.confirmedDocumentCount < o.minDocuments) return "PARTIAL";
  return "AWAITING_CLOSE";
}

/**
 * Who must act:
 * - FIRM_FILING obligations (UStVA) are always the firm's job.
 * - Once enough documents are in (AWAITING_CLOSE), the ball is with staff.
 * - Otherwise the client still owes documents.
 */
export function ownerOf(kind: ObligationKind, receipt: Receipt): Owner {
  if (kind === "FIRM_FILING") return "FIRM";
  return receipt === "AWAITING_CLOSE" ? "FIRM" : "CLIENT";
}

/**
 * Severity of one open obligation:
 * - RED:   overdue and still not received (client late), or an overdue firm filing
 *          (the firm missed a statutory deadline).
 * - AMBER: due soon and not received; or documents are in but staff hasn't closed
 *          a period that is overdue / due soon.
 * - GREEN: upcoming, nothing to chase yet.
 */
export function severityOf(timing: Timing, receipt: Receipt, kind: ObligationKind): Rag {
  const outstanding = kind === "FIRM_FILING" || receipt !== "AWAITING_CLOSE";
  if (timing === "OVERDUE") return outstanding ? "RED" : "AMBER";
  if (timing === "DUE_SOON") return "AMBER";
  return "GREEN";
}

// ─── Ordering (total, so results never depend on input order) ───────────────

const RAG_RANK: Record<Rag, number> = { RED: 0, AMBER: 1, GREEN: 2 };

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

function compareGaps(a: Gap, b: Gap): number {
  return (
    cmp(RAG_RANK[a.severity], RAG_RANK[b.severity]) ||
    cmp(a.dueDate, b.dueDate) ||
    cmp(a.typeCode, b.typeCode) ||
    cmp(a.periodStart, b.periodStart) ||
    cmp(a.obligationId, b.obligationId)
  );
}

function compareClients(a: ClientGaps, b: ClientGaps): number {
  // Worst status first; then the client whose most urgent gap is due earliest;
  // then more overdue items; then client number as a stable tie-breaker.
  const firstDue = (c: ClientGaps) => c.gaps[0]?.dueDate ?? "9999-12-31";
  return (
    cmp(RAG_RANK[a.rag], RAG_RANK[b.rag]) ||
    cmp(firstDue(a), firstDue(b)) ||
    cmp(b.counts.overdue, a.counts.overdue) ||
    cmp(a.clientNumber, b.clientNumber)
  );
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export function computeGaps(input: GapInput): GapReport {
  const dueSoonDays = input.dueSoonDays ?? DEFAULT_DUE_SOON_DAYS;

  const byClient = new Map<string, GapObligation[]>();
  for (const o of input.obligations) {
    const list = byClient.get(o.clientId) ?? [];
    list.push(o);
    byClient.set(o.clientId, list);
  }

  const clients: ClientGaps[] = input.clients.map((client) => {
    const obligations = byClient.get(client.id) ?? [];
    const counts = { overdue: 0, dueSoon: 0, upcoming: 0, closed: 0 };
    const gaps: Gap[] = [];

    for (const o of obligations) {
      // COMPLETE and WAIVED are settled decisions — never a gap.
      if (o.status !== "OPEN") {
        counts.closed++;
        continue;
      }
      const timing = classifyTiming(input.asOf, o.dueDate, dueSoonDays);
      const receipt = classifyReceipt(o);
      gaps.push({
        obligationId: o.id,
        typeCode: o.typeCode,
        typeName: o.typeName,
        periodStart: o.periodStart,
        periodEnd: o.periodEnd,
        dueDate: o.dueDate,
        daysUntilDue: daysBetween(input.asOf, o.dueDate),
        timing,
        receipt,
        owner: ownerOf(o.kind, receipt),
        confirmedDocumentCount: o.confirmedDocumentCount,
        minDocuments: o.minDocuments,
        severity: severityOf(timing, receipt, o.kind),
      });
      if (timing === "OVERDUE") counts.overdue++;
      else if (timing === "DUE_SOON") counts.dueSoon++;
      else counts.upcoming++;
    }

    gaps.sort(compareGaps);
    // A client is as bad as its worst gap.
    const rag: Rag = gaps.length === 0 ? "GREEN" : gaps[0].severity;
    return { clientId: client.id, clientNumber: client.clientNumber, name: client.name, rag, gaps, counts };
  });

  clients.sort(compareClients);
  return { asOf: input.asOf, dueSoonDays, clients };
}
