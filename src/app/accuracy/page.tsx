// Classification accuracy: the model's proposals vs what reviewers confirmed.
// Figures come from the pure computeAccuracy; this page only presents them.

import Link from "next/link";
import { computeAccuracy, type Rate, type ReviewedPair } from "@/domain/accuracy/computeAccuracy";
import type { ClassificationFields, FieldName } from "@/domain/classificationFields";
import { db } from "@/lib/db";
import { loadReviewedPairs, loadUnmeasuredCounts, SEED_MODEL } from "@/server/accuracy/loadAccuracy";
import { DOCUMENT_TYPE_LABELS, formatMoney } from "../_lib/labels";

export const dynamic = "force-dynamic";

const FIELD_LABELS: Record<FieldName, string> = {
  documentType: "Document type",
  documentDate: "Document date",
  amount: "Gross amount",
  vatAmount: "VAT",
  currency: "Currency",
  counterparty: "Counterparty",
};

/** Below this many reviews, percentages swing a lot from one document. */
const SMALL_SAMPLE = 20;

const pct = (r: Rate) => (r.ratio === null ? "–" : `${Math.round(r.ratio * 100)} %`);

function modelLabel(model: string) {
  return model === SEED_MODEL ? "Sample data (seed)" : model;
}

function fieldValue(field: FieldName, f: ClassificationFields): string {
  const v = f[field];
  if (v === null) return "not stated";
  if (field === "documentType") return DOCUMENT_TYPE_LABELS[v] ?? v;
  if (field === "amount" || field === "vatAmount") return formatMoney(v, f.currency);
  return v;
}

/** A single ratio against 100 %: one hue on a same-hue track, value always shown as text. */
function Meter({ rate, noun = "documents" }: { rate: Rate; noun?: string }) {
  if (rate.ratio === null) return <span className="text-ink-muted">–</span>;
  const width = Math.round(rate.ratio * 100);
  const detail = `${rate.correct} of ${rate.total} ${noun}`;
  return (
    <span className="flex items-center gap-3" title={detail}>
      <span aria-hidden className="h-2 w-28 shrink-0 bg-stamp-wash">
        {width > 0 && <span className="block h-full rounded-r-[4px] bg-stamp" style={{ width: `${width}%` }} />}
      </span>
      <span className="font-medium tabular-nums">{pct(rate)}</span>
      <span className="text-ink-muted tabular-nums">
        {rate.correct} of {rate.total}
      </span>
    </span>
  );
}

const th = "px-4 py-2 text-left font-medium text-ink-muted";
const td = "px-4 py-2.5";

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">{intro}</p>
      <div className="mt-4 overflow-x-auto border border-rule bg-sheet">{children}</div>
    </section>
  );
}

export default async function AccuracyPage({ searchParams }: { searchParams: Promise<{ model?: string }> }) {
  const { model: modelParam } = await searchParams;
  const [allPairs, unmeasured] = await Promise.all([loadReviewedPairs(db), loadUnmeasuredCounts(db)]);

  const models = [...new Set(allPairs.map((p) => p.modelUsed))].sort((a, b) => Number(a === SEED_MODEL) - Number(b === SEED_MODEL) || a.localeCompare(b));
  const model = modelParam && models.includes(modelParam) ? modelParam : null;
  const pairs: ReviewedPair[] = model ? allPairs.filter((p) => p.modelUsed === model) : allPairs;
  const report = computeAccuracy(pairs);
  const seedIncluded = pairs.some((p) => p.modelUsed === SEED_MODEL);
  const count = (m: string) => allPairs.filter((p) => p.modelUsed === m).length;

  const filterLink = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? "page" : undefined}
      className={`border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stamp ${
        active ? "border-stamp bg-stamp text-sheet" : "border-rule bg-sheet text-ink hover:border-stamp"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <header className="border-b border-rule py-8">
        <h1 className="text-3xl font-semibold">Classification accuracy</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">
          How often the model&rsquo;s proposal survived human review unchanged. The truth is what a reviewer confirmed: the proposal
          itself, or their correction.
        </p>
        {models.length > 0 && (
          <nav aria-label="Filter by model" className="mt-5 flex flex-wrap gap-2">
            {filterLink("/accuracy", `All reviews (${allPairs.length})`, model === null)}
            {models.map((m) => filterLink(`/accuracy?model=${encodeURIComponent(m)}`, `${modelLabel(m)} (${count(m)})`, model === m))}
          </nav>
        )}
      </header>

      {report.documents.total === 0 ? (
        <p className="py-12 text-ink-muted">
          No reviewed documents yet. Confirm or correct documents on the{" "}
          <Link href="/review" className="text-stamp underline underline-offset-2">
            Review
          </Link>{" "}
          page and their accuracy appears here.
        </p>
      ) : (
        <>
          <section className="mt-8 flex flex-wrap items-end gap-x-10 gap-y-4" aria-label="Overall accuracy">
            <div>
              <p className="text-6xl leading-none font-semibold tabular-nums">{pct(report.documents)}</p>
              <p className="mt-2 max-w-sm text-ink-muted">
                of {report.documents.total} reviewed documents had every field right. Reviewers corrected{" "}
                {report.documents.total - report.documents.correct}.
              </p>
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <dt className="text-ink-muted">Type recognised</dt>
                <dd className="text-lg font-medium tabular-nums">{pct(report.fields.find((f) => f.field === "documentType")!.rate)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Awaiting review</dt>
                <dd className="text-lg font-medium tabular-nums">{unmeasured.awaitingReview}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Rejected</dt>
                <dd className="text-lg font-medium tabular-nums">{unmeasured.rejected}</dd>
              </div>
            </dl>
          </section>

          <div className="mt-6 space-y-2 text-sm">
            {seedIncluded && (
              <p className="border-l-4 border-amber bg-amber-wash px-4 py-2">
                Includes sample data from the seed, whose &ldquo;model&rdquo; mistakes are scripted. Filter by a real model to see its
                actual accuracy.
              </p>
            )}
            {report.documents.total < SMALL_SAMPLE && (
              <p className="text-ink-muted">
                Small sample: with fewer than {SMALL_SAMPLE} reviews, one document moves these percentages a lot.
              </p>
            )}
            <p className="text-ink-muted">
              Documents awaiting review, rejected documents and documents the model could not classify ({unmeasured.notClassified}) are not
              counted: none of them has a confirmed answer to compare with.
            </p>
          </div>

          <Section id="by-type" title="By document type" intro="Grouped by what the document really was, as confirmed by a reviewer.">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-rule">
                <tr>
                  <th className={th}>Document type</th>
                  <th className={th}>Every field right</th>
                  <th className={th}>Type recognised</th>
                  <th className={th}>Most often corrected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {report.byType.map((t) => (
                  <tr key={t.documentType}>
                    <td className={`${td} font-medium`}>{DOCUMENT_TYPE_LABELS[t.documentType]}</td>
                    <td className={td}>
                      <Meter rate={t.documents} />
                    </td>
                    <td className={td}>
                      <Meter rate={t.typeIdentified} />
                    </td>
                    <td className={`${td} text-ink-muted`}>{t.mostCorrectedField ? FIELD_LABELS[t.mostCorrectedField] : "Nothing corrected"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section id="by-field" title="By field" intro="How often each field was right, across all reviewed documents.">
            <table className="w-full min-w-[30rem] text-sm">
              <tbody className="divide-y divide-rule">
                {report.fields.map((f) => (
                  <tr key={f.field}>
                    <td className={`${td} w-48 font-medium`}>{FIELD_LABELS[f.field]}</td>
                    <td className={td}>
                      <Meter rate={f.rate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            id="confidence"
            title="Does the model's confidence mean anything?"
            intro="If confidence is useful, the high bands should be right more often than the low ones. Until it is, review every document the same way."
          >
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="border-b border-rule">
                <tr>
                  <th className={th}>Model confidence</th>
                  <th className={th}>Every field right</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {report.confidence.map((b) => (
                  <tr key={b.label}>
                    <td className={`${td} w-48 font-medium`}>{b.label}</td>
                    <td className={td}>{b.documents.total === 0 ? <span className="text-ink-muted">No documents</span> : <Meter rate={b.documents} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section id="mixups" title="Type mix-ups" intro="Documents whose type the model got wrong.">
            {report.misclassifications.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">The model recognised every document&rsquo;s type.</p>
            ) : (
              <table className="w-full min-w-[30rem] text-sm">
                <thead className="border-b border-rule">
                  <tr>
                    <th className={th}>Model said</th>
                    <th className={th}>It was</th>
                    <th className={`${th} text-right`}>Documents</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {report.misclassifications.map((m) => (
                    <tr key={`${m.proposed}-${m.confirmed}`}>
                      <td className={td}>{DOCUMENT_TYPE_LABELS[m.proposed]}</td>
                      <td className={`${td} font-medium`}>{DOCUMENT_TYPE_LABELS[m.confirmed]}</td>
                      <td className={`${td} text-right tabular-nums`}>{m.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section id="corrections" title="Corrections" intro="Every proposal a reviewer changed, most recent first.">
            {report.corrections.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">No corrections yet.</p>
            ) : (
              <ul className="divide-y divide-rule text-sm">
                {report.corrections.map((c) => (
                  <li key={c.documentId} className="px-4 py-3">
                    <p>
                      <Link href={`/review/${c.documentId}`} className="font-medium text-stamp underline underline-offset-2">
                        {c.filename}
                      </Link>{" "}
                      <span className="text-ink-muted">
                        {c.clientName}, reviewed{" "}
                        {new Date(c.reviewedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" })}
                      </span>
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {c.changed.map((f) => (
                        <li key={f}>
                          <span className="text-ink-muted">{FIELD_LABELS[f]}:</span> <s className="text-ink-muted">{fieldValue(f, c.proposed)}</s>{" "}
                          <span aria-hidden>→</span>
                          <span className="sr-only">corrected to</span> <span className="font-medium">{fieldValue(f, c.confirmed)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
