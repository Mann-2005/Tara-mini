"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { DOCUMENT_TYPE_LABELS, formatMoney } from "../_lib/labels";
import { uploadDocument, type UploadState } from "./actions";

const field = "mt-1 block w-full border border-rule bg-sheet px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stamp";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-ink px-4 py-2 font-medium text-sheet hover:bg-stamp disabled:cursor-wait disabled:bg-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stamp"
    >
      {pending ? "Reading the document…" : "Upload and classify"}
    </button>
  );
}

function Result({ state }: { state: UploadState }) {
  switch (state.status) {
    case "idle":
      return null;
    case "error":
      return <p role="alert" className="border-l-4 border-red bg-red-wash px-4 py-3 text-red">{state.message}</p>;
    case "duplicate":
      return (
        <p role="status" className="border-l-4 border-amber bg-amber-wash px-4 py-3">
          {state.filename} was already uploaded for this client on{" "}
          {new Date(state.uploadedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. Nothing new was
          stored.
        </p>
      );
    case "failed":
      return (
        <div role="alert" className="border-l-4 border-red bg-red-wash px-4 py-3">
          <p className="font-medium text-red">{state.filename} was stored, but could not be classified.</p>
          <p className="mt-1 text-sm">{state.message}</p>
          <p className="mt-1 text-sm text-ink-muted">You can retry it from the list below.</p>
        </div>
      );
    case "proposed": {
      const p = state.proposal;
      const rows: [string, string][] = [
        ["Type", DOCUMENT_TYPE_LABELS[p.documentType]],
        ["Document date", p.documentDate ?? "–"],
        ["Counterparty", p.counterparty ?? "–"],
        ["Gross amount", formatMoney(p.amount, p.currency)],
        ["VAT", formatMoney(p.vatAmount, p.currency)],
        ["Model confidence", `${Math.round(p.confidence * 100)} %`],
      ];
      return (
        <div role="status" className="border border-l-4 border-rule border-l-stamp bg-sheet">
          <p className="border-b border-rule px-4 py-3">
            <span className="font-medium">Proposal for {state.filename}</span>
            <span className="block text-sm text-ink-muted">
              Nothing counts yet. A person has to confirm or correct these fields before the document fulfils an obligation.
            </span>
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 px-4 py-3 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    }
  }
}

export function UploadForm({ clients }: { clients: { id: string; name: string; clientNumber: string }[] }) {
  const [state, action] = useActionState(uploadDocument, { status: "idle" } as UploadState);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <form action={action} className="space-y-5">
        <label className="block text-sm text-ink-muted">
          Client
          <select name="clientId" required defaultValue="" className={field}>
            <option value="" disabled>
              Who sent this document?
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.clientNumber})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-ink-muted">
          Document
          <input
            type="file"
            name="file"
            required
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className={`${field} file:mr-3 file:border-0 file:bg-stamp-wash file:px-3 file:py-1 file:text-stamp`}
          />
          <span className="mt-1 block">PDF, PNG, JPEG or WebP, up to 10 MB.</span>
        </label>
        <SubmitButton />
      </form>

      <div aria-live="polite">
        <Result state={state} />
      </div>
    </div>
  );
}
