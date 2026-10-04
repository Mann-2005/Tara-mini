// Review one document: the original on the left, the model's proposal on the right.

import Link from "next/link";
import { notFound } from "next/navigation";
import { dbToIsoDate } from "@/domain/calendar/isoDate";
import { db } from "@/lib/db";
import { loadReviewDetail } from "@/server/review/loadReview";
import { periodLabel, shortDate } from "../../_lib/format";
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS, formatMoney } from "../../_lib/labels";
import { ReviewForm } from "./ReviewForm";

export const dynamic = "force-dynamic";

function Viewer({ id, mimeType, filename, hasOriginal, rawText }: { id: string; mimeType: string; filename: string; hasOriginal: boolean; rawText: string | null }) {
  if (!hasOriginal) {
    return (
      <div className="flex h-full flex-col">
        <p className="border-b border-rule-soft px-4 py-2 text-sm text-ink-muted">
          No original file is stored for this document (sample data). Showing its extracted text.
        </p>
        <pre className="flex-1 overflow-auto p-4 font-sans text-sm whitespace-pre-wrap">{rawText ?? "No text available."}</pre>
      </div>
    );
  }
  const src = `/api/documents/${id}/file`;
  return mimeType === "application/pdf" ? (
    <iframe src={src} title={filename} className="h-full w-full" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- user upload served from our own route, not a static asset
    <img src={src} alt={`Uploaded document ${filename}`} className="h-full w-full object-contain" />
  );
}

export default async function ReviewDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ drafted?: string; largeAmount?: string }>;
}) {
  const { drafted, largeAmount } = await searchParams;
  const { id } = await params;
  const detail = await loadReviewDetail(db, id);
  if (!detail) notFound();
  const { document, proposal, confirmed, obligations, hasOriginal } = detail;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 py-6">
        <div>
          <Link href="/review" className="brand-link text-sm">
            Back to the review queue
          </Link>
          <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-semibold break-all">
            {document.filename}
            {document.origin === "EIGENBELEG" && <span className="rounded-brand bg-brand px-2 py-0.5 text-xs font-semibold text-lime">Eigenbeleg</span>}
          </h1>
          <p className="mt-1 text-ink-muted">
            {document.origin === "EIGENBELEG" ? "Drafted for" : "From"} {document.client.name} (client {document.client.clientNumber}),{" "}
            {document.origin === "EIGENBELEG" ? `by ${document.uploadedBy} on` : "uploaded"}{" "}
            {document.uploadedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" })}
          </p>
        </div>
        <p className="font-medium">{DOCUMENT_STATUS_LABELS[document.status]}</p>
      </header>

      {drafted && document.status === "PROPOSED" && (
        <div role="status" className="mb-6 border-l-4 border-brand bg-stamp-wash px-4 py-3">
          <p>
            <span className="font-medium">Eigenbeleg {drafted} created.</span> Check the voucher on the left, then confirm it to count it towards the
            selected period. Print it for the client&rsquo;s signature unless they confirmed digitally.
          </p>
          {largeAmount && <p className="mt-1 text-sm text-amber">Over 250 EUR: keep the vendor&rsquo;s duplicate invoice if one can still be obtained.</p>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Original document" className="card h-[75vh] overflow-hidden lg:sticky lg:top-4">
          <Viewer id={document.id} mimeType={document.mimeType} filename={document.filename} hasOriginal={hasOriginal} rawText={document.rawText} />
        </section>

        <section aria-label="Review">
          {document.status === "PROPOSED" && proposal ? (
            <ReviewForm documentId={document.id} proposal={proposal} obligations={obligations} />
          ) : (
            <div className="card space-y-4 px-5 py-4">
              <p className="font-medium">This document has already been reviewed.</p>
              {confirmed && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-ink-muted">Decision</dt>
                  <dd>
                    {confirmed.source === "HUMAN" ? "Corrected" : "Confirmed as proposed"} by {confirmed.confirmedBy}
                  </dd>
                  <dt className="text-ink-muted">Type</dt>
                  <dd>{DOCUMENT_TYPE_LABELS[confirmed.fields.documentType]}</dd>
                  <dt className="text-ink-muted">Date</dt>
                  <dd>{confirmed.fields.documentDate ?? "Not stated"}</dd>
                  <dt className="text-ink-muted">Gross amount</dt>
                  <dd>{formatMoney(confirmed.fields.amount, confirmed.fields.currency)}</dd>
                  <dt className="text-ink-muted">Counterparty</dt>
                  <dd>{confirmed.fields.counterparty ?? "Not stated"}</dd>
                </dl>
              )}
              {document.fulfilments.map((f) => (
                <p key={f.id} className="text-sm">
                  Counts towards {f.obligation.obligationType.name} for{" "}
                  {periodLabel(dbToIsoDate(f.obligation.periodStart), dbToIsoDate(f.obligation.periodEnd))} (due{" "}
                  {shortDate(dbToIsoDate(f.obligation.dueDate))}).
                </p>
              ))}
              {document.status === "PROPOSED" && !proposal && <p className="text-red">There is no model proposal for this document.</p>}
            </div>
          )}

          {document.rawText && hasOriginal && (
            <details className="card rounded-card-sm mt-6 overflow-hidden">
              <summary className="cursor-pointer px-5 py-3 text-sm text-ink-muted">Extracted text</summary>
              <pre className="max-h-80 overflow-auto border-t border-rule-soft px-5 py-4 font-sans text-sm whitespace-pre-wrap">{document.rawText}</pre>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
