// One client on the dashboard: client-owed deliveries on the left, the firm's
// own work (filings, closing periods) on the right, then the V2 insights:
// Compliance Score (header pill), expected-but-missing recurring invoices
// (in "Client owes") and the running VAT forecast (footer panel).

import Link from "next/link";
import type { ClientInsights, GhostCheck } from "@/domain/analytics/insights";
import type { IsoDate } from "@/domain/calendar/isoDate";
import type { ClientGaps, Gap, Rag } from "@/domain/gaps/gapEngine";
import { centsToDecimal } from "@/domain/money";
import { dueText, gapAction, periodLabel, shortDate } from "../_lib/format";
import { GhostRows, ScorePill, VatForecastPanel } from "./Insights";

const RULE: Record<Rag, string> = {
  RED: "border-l-red",
  AMBER: "border-l-amber",
  GREEN: "border-l-green",
};

const DUE_COLOUR: Record<Rag, string> = {
  RED: "text-red",
  AMBER: "text-amber",
  GREEN: "text-ink-muted",
};

// Shape as well as colour, so severity survives greyscale and colour blindness.
const MARKER: Record<Rag, string> = {
  RED: "bg-red",
  AMBER: "bg-amber rotate-45 scale-90",
  GREEN: "border-2 border-green",
};

function countsLine({ overdue, dueSoon }: ClientGaps["counts"]): string {
  const parts = [];
  if (overdue) parts.push(`${overdue} overdue`);
  if (dueSoon) parts.push(`${dueSoon} due soon`);
  return parts.join(", ");
}

function GapRow({ gap, action }: { gap: Gap; action?: React.ReactNode }) {
  const { title, detail } = gapAction(gap);
  // Upcoming items stay visible but quiet, so overdue and due-soon rows carry the weight.
  const quiet = gap.severity === "GREEN";
  return (
    <li className={`flex gap-3 py-2.5 ${quiet ? "text-ink-muted" : ""}`}>
      <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 ${MARKER[gap.severity]}`} />
      <div className="min-w-0 flex-1">
        <p className={`leading-snug ${quiet ? "" : "font-medium text-ink"}`}>
          {title} <span className="font-normal text-ink-muted">for {periodLabel(gap.periodStart, gap.periodEnd)}</span>
        </p>
        <p className="text-sm text-ink-muted">
          {detail}
          {action && <> {action}</>}
        </p>
      </div>
      <div className="shrink-0 text-right text-sm">
        <p className={`font-medium ${DUE_COLOUR[gap.severity]}`}>{dueText(gap.daysUntilDue)}</p>
        <p className="text-ink-muted">{shortDate(gap.dueDate)}</p>
      </div>
    </li>
  );
}

function Column({ heading, empty, firm, children }: { heading: string; empty: string; firm?: boolean; children: React.ReactNode[] }) {
  const items = children.filter(Boolean);
  return (
    <div className={firm ? "bg-stamp-wash px-4 py-3 sm:px-5" : "px-4 py-3 sm:px-5"}>
      <h4 className={`text-sm font-semibold ${firm ? "text-stamp" : "text-ink-muted"}`}>{heading}</h4>
      {items.length === 0 ? <p className="py-2.5 text-sm text-ink-muted">{empty}</p> : <ul className="divide-y divide-rule-soft">{items}</ul>}
    </div>
  );
}

/** Link to the Eigenbeleg form, pre-filled where we know more (e.g. from a missing recurring invoice). */
function eigenbelegLink(obligationId: string, prefill: Record<string, string> = {}) {
  const query = new URLSearchParams({ obligationId, ...prefill }).toString();
  return (
    <Link href={`/eigenbeleg/new?${query}`} className="brand-link whitespace-nowrap">
      Draft Eigenbeleg
    </Link>
  );
}

function ghostPrefill(check: GhostCheck, vendorIndex: number): Record<string, string> {
  const v = check.vendors[vendorIndex];
  // Expected on the same day of the month as last time, clamped to the period.
  const expected = `${check.periodStart.slice(0, 7)}-${v.lastSeenDate.slice(8)}`;
  return {
    payee: v.displayName,
    ...(v.expectedAmountCents !== null ? { amount: centsToDecimal(v.expectedAmountCents).replace(".", ",") } : {}),
    date: expected > check.periodEnd ? check.periodEnd : expected,
  };
}

export function ClientBlock({
  client,
  insights,
  asOf,
  eigenbelegObligationIds,
}: {
  client: ClientGaps;
  insights?: ClientInsights;
  asOf: IsoDate;
  /** Obligations a substitute receipt (Eigenbeleg) can fulfil. */
  eigenbelegObligationIds?: ReadonlySet<string>;
}) {
  // Engine order (most urgent first) is preserved within each column.
  const clientOwes = client.gaps.filter((g) => g.owner === "CLIENT");
  const firmOwes = client.gaps.filter((g) => g.owner === "FIRM");
  const ghosts = insights?.ghosts ?? [];
  const counts = countsLine(client.counts);
  const hasRows = client.gaps.length > 0 || ghosts.length > 0;

  return (
    <article className={`card overflow-hidden border-l-4 ${RULE[client.rag]}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule-soft px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-lg font-semibold">
            {client.name} <span className="text-sm font-normal text-ink-muted">Client {client.clientNumber}</span>
          </h3>
          {insights && <ScorePill score={insights.score} />}
        </div>
        {counts && <p className={`text-sm font-medium ${DUE_COLOUR[client.rag]}`}>{counts}</p>}
      </header>

      {hasRows ? (
        <div className="grid md:grid-cols-2">
          <Column heading="Client owes" empty="Nothing outstanding from the client.">
            {[
              ...clientOwes.map((g) => (
                <GapRow
                  key={g.obligationId}
                  gap={g}
                  action={g.receipt !== "AWAITING_CLOSE" && eigenbelegObligationIds?.has(g.obligationId) ? eigenbelegLink(g.obligationId) : undefined}
                />
              )),
              ghosts.length > 0 && (
                <GhostRows key="ghosts" checks={ghosts} renderAction={(check, i) => eigenbelegLink(check.obligationId, ghostPrefill(check, i))} />
              ),
            ]}
          </Column>
          <Column heading="Firm to do" empty="Nothing for the firm right now." firm>
            {firmOwes.map((g) => (
              <GapRow key={g.obligationId} gap={g} />
            ))}
          </Column>
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-ink-muted sm:px-5">Everything is in. No open obligations.</p>
      )}

      {insights?.vat && <VatForecastPanel vat={insights.vat} asOf={asOf} />}
    </article>
  );
}
