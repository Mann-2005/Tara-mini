// Dashboard: what is missing, from whom, by when.
//
// A Server Component that loads facts from Postgres and hands them to the
// pure gap engine. It makes no decisions of its own: RAG status, timing,
// owner and order all come from computeGaps, the unit-tested module.

import Link from "next/link";
import { parseIsoDate, type IsoDate } from "@/domain/calendar/isoDate";
import { computeGaps, type ClientGaps, type Rag } from "@/domain/gaps/gapEngine";
import { db } from "@/lib/db";
import { todayInGermany } from "@/server/clock";
import { loadGapInput } from "@/server/gaps/loadGapInput";
import { ClientBlock } from "./_components/ClientBlock";
import { longDate } from "./_lib/format";

export const dynamic = "force-dynamic";

function validDate(value: string | undefined): IsoDate | undefined {
  if (!value) return undefined;
  try {
    parseIsoDate(value);
    return value;
  } catch {
    return undefined;
  }
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const { asOf: asOfParam } = await searchParams;
  const today = todayInGermany();
  const asOf = validDate(asOfParam) ?? today;

  const report = computeGaps(await loadGapInput(db, asOf));
  const byRag = (rag: Rag) => report.clients.filter((c) => c.rag === rag);

  const sections: { rag: Rag; title: string; blurb: string; clients: ClientGaps[] }[] = [
    { rag: "RED", title: "Overdue", blurb: "A deadline has passed and the documents or filing are still missing.", clients: byRag("RED") },
    {
      rag: "AMBER",
      title: "Needs attention",
      blurb: `Due within ${report.dueSoonDays} days, or documents are in and the firm still has to close the period.`,
      clients: byRag("AMBER"),
    },
    { rag: "GREEN", title: "On track", blurb: `Nothing due in the next ${report.dueSoonDays} days.`, clients: byRag("GREEN") },
  ];

  const allGaps = report.clients.flatMap((c) => c.gaps);
  const filings = allGaps.filter((g) => g.kind === "FIRM_FILING").length;
  const toClose = allGaps.filter((g) => g.kind === "CLIENT_DELIVERY" && g.owner === "FIRM").length;
  const clientItems = allGaps.filter((g) => g.owner === "CLIENT").length;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-rule py-8">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-stamp">Tara Mini</p>
          <h1 className="mt-2 text-3xl leading-tight font-semibold text-balance sm:text-4xl">
            What&rsquo;s missing as of {longDate(asOf)}
          </h1>
          {report.clients.length > 0 && (
            <p className="mt-3 text-ink-muted">
              {plural(sections[0].clients.length, "client is", "clients are")} overdue,{" "}
              {plural(sections[1].clients.length, "needs", "need")} attention and {sections[2].clients.length} on track.
              Clients owe {plural(clientItems, "delivery", "deliveries")}; the firm has{" "}
              {plural(filings, "filing", "filings")} to submit and {plural(toClose, "period", "periods")} to close.
            </p>
          )}
        </div>

        <form className="flex items-end gap-2" action="/" method="get">
          <label className="text-sm text-ink-muted">
            Show as of
            <input
              type="date"
              name="asOf"
              defaultValue={asOf}
              className="mt-1 block border border-rule bg-sheet px-2 py-1.5 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stamp"
            />
          </label>
          <button
            type="submit"
            className="bg-ink px-3 py-1.5 text-sm font-medium text-sheet hover:bg-stamp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stamp"
          >
            Show
          </button>
          {asOf !== today && (
            <Link href="/" className="px-1 py-1.5 text-sm text-stamp underline underline-offset-2">
              Back to today
            </Link>
          )}
        </form>
      </header>

      {report.clients.length === 0 ? (
        <p className="py-12 text-ink-muted">
          No active clients yet. Run <code>pnpm db:seed</code> to load the sample clients.
        </p>
      ) : (
        sections.map(
          (s) =>
            s.clients.length > 0 && (
              <section key={s.rag} aria-labelledby={`section-${s.rag}`} className="mt-10">
                <div className="mb-4 flex flex-wrap items-baseline gap-x-3">
                  <h2 id={`section-${s.rag}`} className="text-xl font-semibold">
                    {s.title} <span className="font-normal text-ink-muted">({s.clients.length})</span>
                  </h2>
                  <p className="text-sm text-ink-muted">{s.blurb}</p>
                </div>
                <div className="space-y-4">
                  {s.clients.map((c) => (
                    <ClientBlock key={c.clientId} client={c} />
                  ))}
                </div>
              </section>
            ),
        )
      )}
    </div>
  );
}
