// V2 insight widgets for the client block. Presentation only: every figure
// comes from computeClientInsights (src/domain/analytics/insights.ts).

import type { ClientScore, Grade } from "@/domain/analytics/clientScore";
import type { GhostCheck, VatForecast } from "@/domain/analytics/insights";
import type { IsoDate } from "@/domain/calendar/isoDate";
import { centsToDecimal } from "@/domain/money";
import { longDate, periodLabel, shortDate } from "../_lib/format";
import { formatMoney } from "../_lib/labels";

const eur = (cents: number) => formatMoney(centsToDecimal(cents));

const monthName = (isoMonth: string) =>
  new Date(`${isoMonth}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

// ─── Compliance Score pill ─────────────────────────────────────────────────

/** A and B in brand colours (good standing); C and D in the warning palette. */
const GRADE_STYLE: Record<Grade, string> = {
  A: "bg-brand text-lime",
  B: "bg-mint text-brand",
  C: "bg-amber-wash text-amber",
  D: "bg-red-wash text-red",
};

export function ScorePill({ score }: { score: ClientScore }) {
  const base = "inline-flex items-center rounded-brand px-2 py-0.5 text-xs font-semibold whitespace-nowrap";
  if (score.grade === null || score.points === null || score.averageDelayDays === null) {
    return (
      <span className={`${base} border border-rule font-medium text-ink-muted`} title={`Compliance Score needs at least 3 deliveries in the last 6 months (has ${score.measured}).`}>
        No grade yet
      </span>
    );
  }
  const detail =
    `Compliance Score: average ${score.averageDelayDays.toFixed(1)} days late over ${score.measured} deliveries ` +
    `in the last 6 months (${score.onTime} on time${score.stillOpenOverdue ? `, ${score.stillOpenOverdue} still missing` : ""}).`;
  return (
    <span className={`${base} ${GRADE_STYLE[score.grade]}`} title={detail} aria-label={`Compliance Score grade ${score.grade}, ${score.points} of 100. ${detail}`}>
      Grade {score.grade} • {score.points}/100
    </span>
  );
}

// ─── VAT forecast ──────────────────────────────────────────────────────────

export function VatForecastPanel({ vat, asOf }: { vat: VatForecast; asOf: IsoDate }) {
  const net = Math.abs(vat.netCents);
  const balance =
    vat.position === "PAYABLE"
      ? { label: "Estimated Zahllast", value: eur(net), tone: "text-ink" }
      : vat.position === "REFUND"
        ? { label: "Estimated Guthaben", value: eur(net), tone: "text-brand" }
        : { label: "Estimated balance", value: eur(0), tone: "text-ink" };
  const missing = vat.notCounted.missingVat + vat.notCounted.foreignCurrency;

  return (
    <section aria-label="VAT forecast" className="border-t border-rule-soft bg-stone px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h4 className="text-sm font-semibold">
          VAT forecast, {periodLabel(vat.period.start, vat.period.end)}{" "}
          <span className="font-normal text-ink-muted">(return due {shortDate(vat.dueDate)})</span>
        </h4>
        {!vat.periodComplete && (
          <p className="text-sm text-ink-muted">Running total, counted until {shortDate(vat.countedUntil)}</p>
        )}
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <dt className="text-xs text-ink-muted">Vorsteuer so far</dt>
          <dd className="font-medium tabular-nums">{eur(vat.inputVatCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Umsatzsteuer so far</dt>
          <dd className="font-medium tabular-nums">{eur(vat.outputVatCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">{balance.label}</dt>
          <dd className={`text-lg leading-tight font-semibold tabular-nums ${balance.tone}`}>{balance.value}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-ink-muted">
        Provisional estimate based on confirmed documents as of {longDate(asOf)}. Subject to final ELSTER filing.
        {missing > 0 && ` ${missing} document${missing === 1 ? "" : "s"} without a usable EUR VAT amount ${missing === 1 ? "is" : "are"} not included.`}
      </p>
    </section>
  );
}

// ─── Ghost invoices ────────────────────────────────────────────────────────

export function GhostRows({ checks, renderAction }: { checks: GhostCheck[]; renderAction?: (check: GhostCheck, vendorIndex: number) => React.ReactNode }) {
  return (
    <>
      {checks.flatMap((check) =>
        check.vendors.map((v, i) => (
          <li key={`${check.obligationId}-${v.vendorKey}`} className="flex gap-3 py-2.5">
            {/* Dashed marker: an expectation, not a deadline. Ghosts never change the RAG status. */}
            <span aria-hidden className="mt-1.5 size-2.5 shrink-0 border border-dashed border-amber" />
            <div className="min-w-0 flex-1">
              <p className="leading-snug">
                <span className="font-medium">Missing expected recurring invoice:</span> {v.displayName}
                {v.expectedAmountCents !== null && <span className="whitespace-nowrap"> (~{eur(v.expectedAmountCents)})</span>}
              </p>
              <p className="text-sm text-ink-muted">
                Arrived in {v.monthsSeen.map(monthName).join(", ")}; nothing yet for {periodLabel(check.periodStart, check.periodEnd)}.
                {renderAction && <> {renderAction(check, i)}</>}
              </p>
            </div>
          </li>
        )),
      )}
    </>
  );
}
