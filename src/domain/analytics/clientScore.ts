// Mandanten-Score: how promptly a client delivers. Pure and deterministic.
//
// Measures the client's own behaviour only:
// - CLIENT_DELIVERY obligations (documents the client owes). Firm filings
//   (UStVA) are the firm's job and never lower the client's grade.
// - Lateness = when the client's documents ARRIVED, not when staff closed the
//   period: the upload date of the document that reached the obligation's
//   minimum. An obligation completed without enough documents falls back to
//   its completion date; one still not delivered keeps accruing delay until
//   the as-of date.
// - Window: obligations due in the last `windowMonths` months, up to as-of.
//   Waived and not-yet-due obligations are excluded.
//
// Average delay → grade (points are a linear scale within each band and are
// clamped to it, so grade and points always agree):
//   A  avg ≤ 1 day    100 → 90     always on time
//   B  avg ≤ 5 days    89 → 75     minor chasing
//   C  avg ≤ 14 days   74 → 50     high touch
//   D  avg > 14 days   49 → 0      chronic backlog (0 at 44 days)
// Fewer than `minObligations` measured → no grade ("not enough history").
//
// NOTE: a compliance (timeliness) index. It does not measure profitability:
// fees and hours are not in the data.

import { addMonths, daysBetween, daysInMonth, parseIsoDate, toIsoDate, type IsoDate } from "../calendar/isoDate";
import type { ObligationKind, ObligationStatus } from "../obligations/types";
import { compareText } from "./compare";

export interface ScoreObligation {
  id: string;
  kind: ObligationKind;
  status: ObligationStatus;
  dueDate: IsoDate;
  minDocuments: number;
  completedAt: IsoDate | null;
  /** Upload dates of the confirmed, non-revoked documents that fulfil it. */
  deliveryDates: readonly IsoDate[];
}

export type Grade = "A" | "B" | "C" | "D";

export interface ScoredObligation {
  obligationId: string;
  dueDate: IsoDate;
  /** When the client delivered, or null if still outstanding at as-of. */
  deliveredOn: IsoDate | null;
  delayDays: number;
}

export interface ClientScore {
  clientId: string;
  grade: Grade | null;
  points: number | null;
  reason: "SCORED" | "INSUFFICIENT_HISTORY";
  averageDelayDays: number | null;
  window: { from: IsoDate; to: IsoDate };
  measured: number;
  onTime: number;
  stillOpenOverdue: number;
  /** Up to three latest deliveries, worst first: for an explanatory tooltip. */
  worst: ScoredObligation[];
}

export interface ScoreOptions {
  windowMonths?: number;
  minObligations?: number;
}

interface Band {
  grade: Grade;
  maxAvg: number;
  /** Points at the band's lower delay edge (best) and upper edge (worst). */
  best: number;
  worst: number;
  /** Delay at which the band starts / ends, for linear interpolation. */
  from: number;
  to: number;
}

const BANDS: readonly Band[] = [
  { grade: "A", maxAvg: 1, best: 100, worst: 90, from: 0, to: 1 },
  { grade: "B", maxAvg: 5, best: 89, worst: 75, from: 1, to: 5 },
  { grade: "C", maxAvg: 14, best: 74, worst: 50, from: 5, to: 14 },
  { grade: "D", maxAvg: Infinity, best: 49, worst: 0, from: 14, to: 44 },
];

/** Grade and points for an average delay (exported for direct testing of the scale). */
export function gradeForAverageDelay(averageDelayDays: number): { grade: Grade; points: number } {
  if (!(averageDelayDays >= 0)) throw new Error(`Average delay must be ≥ 0, got ${averageDelayDays}`);
  const band = BANDS.find((b) => averageDelayDays <= b.maxAvg)!;
  const progress = Math.min(1, (averageDelayDays - band.from) / (band.to - band.from));
  const raw = band.best - progress * (band.best - band.worst);
  const points = Math.min(band.best, Math.max(band.worst, Math.round(raw)));
  return { grade: band.grade, points };
}

/** The same calendar day `months` months earlier, clamped to the month's length. */
function monthsBefore(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  const target = addMonths(year, month, -months);
  return toIsoDate(target.year, target.month, Math.min(day, daysInMonth(target.year, target.month)));
}

function scoreOne(o: ScoreObligation, asOf: IsoDate): ScoredObligation {
  const delivered = [...o.deliveryDates].filter((d) => d <= asOf).sort();
  let deliveredOn: IsoDate | null = null;
  if (delivered.length >= o.minDocuments) deliveredOn = delivered[o.minDocuments - 1];
  else if (o.status === "COMPLETE" && o.completedAt !== null && o.completedAt <= asOf) deliveredOn = o.completedAt;

  const until = deliveredOn ?? asOf;
  return { obligationId: o.id, dueDate: o.dueDate, deliveredOn, delayDays: Math.max(0, daysBetween(o.dueDate, until)) };
}

export function computeClientScore(
  client: { id: string },
  obligations: readonly ScoreObligation[],
  asOf: IsoDate,
  options: ScoreOptions = {},
): ClientScore {
  const windowMonths = options.windowMonths ?? 6;
  const minObligations = options.minObligations ?? 3;
  if (!Number.isInteger(windowMonths) || windowMonths < 1) throw new Error(`windowMonths must be a positive integer, got ${windowMonths}`);
  if (!Number.isInteger(minObligations) || minObligations < 1) throw new Error(`minObligations must be a positive integer, got ${minObligations}`);

  const from = monthsBefore(asOf, windowMonths);
  const scored = obligations
    .filter((o) => o.kind === "CLIENT_DELIVERY" && o.status !== "WAIVED" && o.dueDate > from && o.dueDate <= asOf)
    .map((o) => scoreOne(o, asOf));

  const base = {
    clientId: client.id,
    window: { from, to: asOf },
    measured: scored.length,
    onTime: scored.filter((s) => s.deliveredOn !== null && s.delayDays === 0).length,
    stillOpenOverdue: scored.filter((s) => s.deliveredOn === null && s.delayDays > 0).length,
    worst: scored
      .filter((s) => s.delayDays > 0)
      .sort((a, b) => b.delayDays - a.delayDays || compareText(a.dueDate, b.dueDate) || compareText(a.obligationId, b.obligationId))
      .slice(0, 3),
  };

  if (scored.length < minObligations) {
    return { ...base, grade: null, points: null, reason: "INSUFFICIENT_HISTORY", averageDelayDays: null };
  }

  const averageDelayDays = scored.reduce((sum, s) => sum + s.delayDays, 0) / scored.length;
  const { grade, points } = gradeForAverageDelay(averageDelayDays);
  return { ...base, grade, points, reason: "SCORED", averageDelayDays };
}
