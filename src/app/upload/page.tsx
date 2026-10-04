// Upload page: store a client document and get an LLM proposal for it.
// The proposal is never authoritative; it waits for human review.

import { db } from "@/lib/db";
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from "../_lib/labels";
import { retryClassification } from "./actions";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

const STATUS_COLOUR: Record<string, string> = {
  PENDING: "text-red",
  PROPOSED: "text-amber", // needs a person — not green, which means "done"
  CONFIRMED: "text-green",
  REJECTED: "text-ink-muted",
};

export default async function UploadPage() {
  const [clients, recent] = await Promise.all([
    db.client.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, clientNumber: true } }),
    db.document.findMany({
      orderBy: { uploadedAt: "desc" },
      take: 15,
      include: {
        client: { select: { name: true } },
        classifications: { where: { source: "LLM" }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <header className="border-b border-rule py-8">
        <h1 className="text-3xl font-semibold">Upload a document</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">
          The model reads the document and proposes its type, date, amounts and counterparty. Nothing counts towards a client&rsquo;s
          obligations until someone confirms the proposal.
        </p>
      </header>

      <section className="mt-8">
        <UploadForm clients={clients} />
      </section>

      <section className="mt-12" aria-labelledby="recent">
        <h2 id="recent" className="text-xl font-semibold">
          Recent uploads
        </h2>
        <div className="card mt-4 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-rule-soft text-ink-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Uploaded</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Model&rsquo;s proposal</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule-soft">
              {recent.map((d) => {
                const llm = d.classifications[0];
                return (
                  <tr key={d.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-ink-muted">
                      {d.uploadedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" })}
                    </td>
                    <td className="px-4 py-2">{d.client.name}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2" title={d.filename}>
                      {d.filename}
                    </td>
                    <td className="px-4 py-2">
                      {llm ? (
                        <>
                          {DOCUMENT_TYPE_LABELS[llm.documentType]}
                          {llm.confidence !== null && <span className="whitespace-nowrap text-ink-muted"> ({Math.round(llm.confidence * 100)} %)</span>}
                        </>
                      ) : d.origin === "EIGENBELEG" ? (
                        <span>
                          <span className="rounded-brand bg-brand px-1.5 py-0.5 text-xs font-semibold text-lime">Eigenbeleg</span>{" "}
                          <span className="text-ink-muted">entered by staff</span>
                        </span>
                      ) : (
                        <span className="text-ink-muted">None yet</span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`font-medium ${STATUS_COLOUR[d.status]}`}>{DOCUMENT_STATUS_LABELS[d.status]}</span>
                      {d.status === "PENDING" && (
                        <form action={retryClassification} className="ml-3 inline">
                          <input type="hidden" name="documentId" value={d.id} />
                          <button type="submit" className="brand-link font-normal">
                            Retry
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
