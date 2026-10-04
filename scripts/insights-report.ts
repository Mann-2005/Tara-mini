// Prints the V2 insights (Compliance Score, VAT forecast, ghost invoices) per client.
//
//   pnpm insights               # as of today (Europe/Berlin)
//   pnpm insights 2026-10-02    # as of a given date

import "dotenv/config";
import { computeClientInsights } from "../src/domain/analytics/insights";
import { parseIsoDate } from "../src/domain/calendar/isoDate";
import { centsToDecimal } from "../src/domain/money";
import { db } from "../src/lib/db";
import { loadInsightsInputs } from "../src/server/analytics/loadInsightsInput";
import { todayInGermany } from "../src/server/clock";

const eur = (cents: number) => `${Number(centsToDecimal(cents)).toLocaleString("de-DE", { minimumFractionDigits: 2 })} EUR`;

async function main() {
  const asOf = process.argv[2] ?? todayInGermany();
  parseIsoDate(asOf);
  const inputs = await loadInsightsInputs(db, asOf);
  const names = new Map((await db.client.findMany({ select: { id: true, clientNumber: true, name: true } })).map((c) => [c.id, `${c.clientNumber} ${c.name}`]));

  console.log(`Insights as of ${asOf}\n`);
  for (const input of inputs) {
    const r = computeClientInsights(input);
    const s = r.score;
    console.log(names.get(r.clientId));
    console.log(
      s.grade
        ? `  Compliance Score  Grade ${s.grade} • ${s.points}/100   avg delay ${s.averageDelayDays!.toFixed(1)} days over ${s.measured} obligations (${s.onTime} on time, ${s.stillOpenOverdue} still open)`
        : `  Compliance Score  not enough history (${s.measured} obligations)`,
    );
    for (const w of s.worst) console.log(`      late: due ${w.dueDate}, ${w.delayDays} day${w.delayDays === 1 ? "" : "s"}${w.deliveredOn ? ` (delivered ${w.deliveredOn})` : " (still missing)"}`);

    if (r.vat) {
      const v = r.vat;
      const label = v.position === "PAYABLE" ? "Zahllast" : v.position === "REFUND" ? "Guthaben" : "Zero";
      console.log(
        `  VAT ${v.period.start}…${v.period.end} (due ${v.dueDate})  Vorsteuer ${eur(v.inputVatCents)}  Umsatzsteuer ${eur(v.outputVatCents)}  → ${label} ${eur(Math.abs(v.netCents))}` +
          `${v.periodComplete ? "" : `  [running, counted until ${v.countedUntil}]`}` +
          `${v.notCounted.missingVat + v.notCounted.foreignCurrency > 0 ? `  (not counted: ${v.notCounted.missingVat} without VAT, ${v.notCounted.foreignCurrency} foreign currency)` : ""}`,
      );
    } else {
      console.log("  VAT forecast      none (VAT-exempt or nothing to file)");
    }

    for (const g of r.ghosts) {
      for (const v of g.vendors) {
        console.log(
          `  Ghost invoice     ${g.typeName} ${g.periodStart.slice(0, 7)}: missing expected recurring invoice from ${v.displayName}` +
            `${v.expectedAmountCents === null ? "" : ` (~${eur(v.expectedAmountCents)})`}, seen ${v.monthsSeen.join(", ")}`,
        );
      }
    }
    console.log();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
