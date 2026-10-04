// Predictive gap analysis: the "ghost" invoice detector. Pure and deterministic.
//
// A vendor whose expense documents (incoming invoices / receipts) were
// CONFIRMED in at least `minMonths` of the `lookbackMonths` calendar months
// before the current month, but who has no document at all (confirmed or
// proposed) dated in the current month, is reported as an anticipated missing
// vendor: "Missing expected recurring invoice: O2 (~45,00 EUR)".
//
// It only raises a question for staff; it never changes an obligation.

import { addMonths, toIsoDate, toIsoMonth, type IsoDate, type IsoMonth } from "../calendar/isoDate";
import type { DocumentType } from "../obligations/types";
import { toCents } from "../money";
import { compareText } from "./compare";
import type { AnalyticsDocument } from "./types";
import { vendorKey } from "./vendorKey";

export interface GhostInvoice {
  vendorKey: string;
  /** The vendor's name as written on its most recent confirmed document. */
  displayName: string;
  /** Months (YYYY-MM, ascending) in the lookback window where the vendor appeared. */
  monthsSeen: IsoMonth[];
  /** Mean of the monthly gross totals in the months seen, in cents (rounded half-up); null if no amounts were stated. */
  expectedAmountCents: number | null;
  lastSeenDate: IsoDate;
}

export interface GhostOptions {
  /** Calendar months before the current one to look at. Default 3 (spec: 3–6). */
  lookbackMonths?: number;
  /** In how many of those months the vendor must appear to count as recurring. Default 2. */
  minMonths?: number;
}

/** Expense documents: the ones a recurring vendor sends. */
const EXPENSE_TYPES: readonly DocumentType[] = ["INCOMING_INVOICE", "RECEIPT"];

const monthOf = (date: IsoDate): IsoMonth => date.slice(0, 7);

interface VendorHistory {
  monthTotals: Map<IsoMonth, number | null>; // null = seen, but no amount stated
  latest: { date: IsoDate; documentId: string; name: string };
}

export function detectGhostInvoices(
  clientId: string,
  currentPeriodStart: IsoDate,
  documents: readonly AnalyticsDocument[],
  options: GhostOptions = {},
): GhostInvoice[] {
  const lookbackMonths = options.lookbackMonths ?? 3;
  const minMonths = options.minMonths ?? 2;
  if (!Number.isInteger(lookbackMonths) || lookbackMonths < 1 || lookbackMonths > 12) {
    throw new Error(`lookbackMonths must be an integer from 1 to 12, got ${lookbackMonths}`);
  }
  if (!Number.isInteger(minMonths) || minMonths < 1 || minMonths > lookbackMonths) {
    throw new Error(`minMonths must be an integer from 1 to lookbackMonths, got ${minMonths}`);
  }

  const current = { year: Number(currentPeriodStart.slice(0, 4)), month: Number(currentPeriodStart.slice(5, 7)) };
  // Validates the date and normalises to the first of the month.
  const currentMonth = monthOf(toIsoDate(current.year, current.month, 1));
  const lookback = new Set<IsoMonth>();
  for (let i = 1; i <= lookbackMonths; i++) {
    const ym = addMonths(current.year, current.month, -i);
    lookback.add(toIsoMonth(ym.year, ym.month));
  }

  const history = new Map<string, VendorHistory>();
  const presentThisMonth = new Set<string>();

  for (const doc of documents) {
    if (doc.clientId !== clientId || !doc.documentDate || !doc.counterparty) continue;
    const key = vendorKey(doc.counterparty);
    if (key === "") continue;
    const month = monthOf(doc.documentDate);

    // Has this vendor's document for the current month arrived? Any confirmed or
    // proposed document counts — even one the model misfiled as OTHER — except a
    // sale TO that party (outgoing invoice), which is not the expected bill.
    if (month === currentMonth) {
      if (doc.documentType !== "OUTGOING_INVOICE") presentThisMonth.add(key);
      continue;
    }

    // History: only human-confirmed expense documents inside the lookback window.
    if (doc.status !== "CONFIRMED" || !EXPENSE_TYPES.includes(doc.documentType) || !lookback.has(month)) continue;

    const entry = history.get(key) ?? { monthTotals: new Map(), latest: { date: doc.documentDate, documentId: doc.documentId, name: doc.counterparty } };
    const previous = entry.monthTotals.get(month);
    if (doc.amount === null) {
      if (previous === undefined) entry.monthTotals.set(month, null);
    } else {
      entry.monthTotals.set(month, (previous ?? 0) + toCents(doc.amount));
    }
    const newer =
      doc.documentDate > entry.latest.date || (doc.documentDate === entry.latest.date && doc.documentId > entry.latest.documentId);
    if (newer) entry.latest = { date: doc.documentDate, documentId: doc.documentId, name: doc.counterparty };
    history.set(key, entry);
  }

  const ghosts: GhostInvoice[] = [];
  for (const [key, entry] of history) {
    if (entry.monthTotals.size < minMonths || presentThisMonth.has(key)) continue;
    const totals = [...entry.monthTotals.values()].filter((t): t is number => t !== null);
    ghosts.push({
      vendorKey: key,
      displayName: entry.latest.name,
      monthsSeen: [...entry.monthTotals.keys()].sort(),
      expectedAmountCents: totals.length === 0 ? null : Math.round(totals.reduce((a, b) => a + b, 0) / totals.length),
      lastSeenDate: entry.latest.date,
    });
  }

  // Largest expected amount first (unknown amounts last), then by key: a total order.
  return ghosts.sort(
    (a, b) =>
      (b.expectedAmountCents ?? -Infinity) - (a.expectedAmountCents ?? -Infinity) ||
      compareText(a.vendorKey, b.vendorKey),
  );
}
