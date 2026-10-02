// Prints the gap report for the current database.
//
//   pnpm gaps               # as of today (Europe/Berlin)
//   pnpm gaps 2026-10-02    # as of a given date

import "dotenv/config";
import { parseIsoDate } from "../src/domain/calendar/isoDate";
import { computeGaps } from "../src/domain/gaps/gapEngine";
import { todayInGermany } from "../src/server/clock";
import { loadGapInput } from "../src/server/gaps/loadGapInput";
import { db } from "../src/lib/db";

async function main() {
  const asOf = process.argv[2] ?? todayInGermany();
  parseIsoDate(asOf); // validate

  const report = computeGaps(await loadGapInput(db, asOf));
  console.log(`Gap report as of ${report.asOf} (due soon = within ${report.dueSoonDays} days)\n`);

  for (const c of report.clients) {
    const { overdue, dueSoon, upcoming, closed } = c.counts;
    console.log(`[${c.rag.padEnd(5)}] ${c.clientNumber} ${c.name}  — overdue ${overdue}, due soon ${dueSoon}, upcoming ${upcoming}, closed ${closed}`);
    for (const g of c.gaps) {
      const when = g.daysUntilDue < 0 ? `${-g.daysUntilDue}d overdue` : g.daysUntilDue === 0 ? "due today" : `in ${g.daysUntilDue}d`;
      const docs = g.receipt === "MISSING" ? "missing" : `${g.receipt.toLowerCase()} (${g.confirmedDocumentCount}/${g.minDocuments})`;
      console.log(
        `    ${g.severity.padEnd(5)} ${g.typeCode.padEnd(18)} ${g.periodStart}…${g.periodEnd}  due ${g.dueDate} (${when.padEnd(12)}) ${docs.padEnd(24)} → ${g.owner}`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
