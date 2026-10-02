// Review queue: every document with an unconfirmed model proposal, oldest first.

import Link from "next/link";
import { db } from "@/lib/db";
import { loadReviewQueue } from "@/server/review/loadReview";
import { DOCUMENT_TYPE_LABELS } from "../_lib/labels";

export const dynamic = "force-dynamic";

const OUTCOME_TEXT: Record<string, string> = {
  confirmed: "confirmed as proposed",
  corrected: "corrected and confirmed",
  rejected: "rejected",
};

export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<{ done?: string; outcome?: string }> }) {
  const { done, outcome } = await searchParams;
  const [queue, doneDoc] = await Promise.all([
    loadReviewQueue(db),
    done ? db.document.findUnique({ where: { id: done }, select: { id: true, filename: true } }) : null,
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <header className="border-b border-rule py-8">
        <h1 className="text-3xl font-semibold">Review</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">
          Check what the model read from each document. A document only counts towards a client&rsquo;s obligations once you confirm it.
        </p>
      </header>

      {doneDoc && outcome && OUTCOME_TEXT[outcome] && (
        <p role="status" className="mt-6 border-l-4 border-green bg-green-wash px-4 py-3">
          {doneDoc.filename} was {OUTCOME_TEXT[outcome]}.{" "}
          <Link href={`/review/${doneDoc.id}`} className="text-stamp underline underline-offset-2">
            See the decision
          </Link>
        </p>
      )}

      {queue.length === 0 ? (
        <p className="mt-8 text-ink-muted">
          Nothing to review.{" "}
          <Link href="/upload" className="text-stamp underline underline-offset-2">
            Upload a document
          </Link>{" "}
          to get started.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-rule border border-rule bg-sheet">
          {queue.map((d) => {
            const llm = d.classifications[0];
            const low = llm?.confidence !== null && llm?.confidence !== undefined && llm.confidence < 0.8;
            return (
              <li key={d.id}>
                <Link href={`/review/${d.id}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-4 hover:bg-paper focus-visible:outline-2 focus-visible:outline-stamp">
                  <span>
                    <span className="font-medium">{d.filename}</span>
                    <span className="block text-sm text-ink-muted">
                      {d.client.name}, uploaded{" "}
                      {d.uploadedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Berlin" })}
                    </span>
                  </span>
                  <span className="text-sm">
                    {llm ? DOCUMENT_TYPE_LABELS[llm.documentType] : "No proposal"}
                    {llm?.confidence !== null && llm?.confidence !== undefined && (
                      <span className={low ? " font-medium text-amber" : " text-ink-muted"}> ({Math.round(llm.confidence * 100)} %)</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
