// Draft an Eigenbeleg (substitute voucher) for a missing receipt.
// Pre-filled from the dashboard (?obligationId=…&payee=…&amount=…&date=…).

import Link from "next/link";
import { dbToIsoDate } from "@/domain/calendar/isoDate";
import { db } from "@/lib/db";
import { periodLabel } from "../../_lib/format";
import { EigenbelegForm, type EligibleObligation } from "./EigenbelegForm";

export const dynamic = "force-dynamic";

export default async function NewEigenbelegPage({
  searchParams,
}: {
  searchParams: Promise<{ obligationId?: string; payee?: string; amount?: string; date?: string }>;
}) {
  const params = await searchParams;

  // Open client deliveries that accept receipts (e.g. Eingangsrechnungen).
  const rows = await db.obligation.findMany({
    where: {
      status: "OPEN",
      client: { isActive: true },
      obligationType: { kind: "CLIENT_DELIVERY", acceptedDocumentTypes: { has: "RECEIPT" } },
    },
    include: { client: { select: { name: true } }, obligationType: { select: { name: true } } },
    orderBy: [{ client: { name: "asc" } }, { periodStart: "asc" }],
  });
  const obligations: EligibleObligation[] = rows.map((o) => ({
    id: o.id,
    clientName: o.client.name,
    label: `${o.obligationType.name} for ${periodLabel(dbToIsoDate(o.periodStart), dbToIsoDate(o.periodEnd))}`,
    periodStart: dbToIsoDate(o.periodStart),
    periodEnd: dbToIsoDate(o.periodEnd),
  }));
  const preselected = obligations.find((o) => o.id === params.obligationId);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
      <header className="py-8">
        <Link href="/" className="brand-link text-sm">
          Back to what&rsquo;s missing
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">Draft an Eigenbeleg</h1>
        <p className="mt-2 text-ink-muted">
          A substitute voucher for a business expense whose receipt is missing{preselected ? ` (${preselected.clientName})` : ""}. Use it only when a
          replacement can&rsquo;t be obtained: for an invoice, ask the vendor for a duplicate first.
        </p>
      </header>

      {obligations.length === 0 ? (
        <p className="card px-5 py-4 text-ink-muted">No open period accepts receipts right now.</p>
      ) : (
        <EigenbelegForm
          obligations={obligations}
          defaults={{
            obligationId: preselected?.id ?? "",
            payee: params.payee ?? "",
            amount: params.amount ?? "",
            expenseDate: params.date && preselected && params.date >= preselected.periodStart && params.date <= preselected.periodEnd ? params.date : "",
          }}
        />
      )}
    </div>
  );
}
