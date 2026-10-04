"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { matchObligations, type LinkableObligation } from "@/domain/fulfilment/matchObligations";
import { parseMoney } from "@/domain/money";
import { DOCUMENT_TYPES, type DocumentType } from "@/domain/obligations/types";
import type { ClassificationFields, FieldName } from "@/server/review/fields";
import { periodLabel, shortDate } from "../../_lib/format";
import { DOCUMENT_TYPE_LABELS, formatMoney } from "../../_lib/labels";
import { confirmAction, rejectAction, type ReviewState } from "../actions";

type FormValues = Record<FieldName, string>;

const LABELS: Record<FieldName, string> = {
  documentType: "Document type",
  documentDate: "Document date",
  amount: "Gross amount",
  vatAmount: "VAT",
  currency: "Currency",
  counterparty: "Counterparty",
};

const germanMoney = (v: string | null) =>
  v === null ? "" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toFormValues(f: ClassificationFields): FormValues {
  return {
    documentType: f.documentType,
    documentDate: f.documentDate ?? "",
    amount: germanMoney(f.amount),
    vatAmount: germanMoney(f.vatAmount),
    currency: f.currency,
    counterparty: f.counterparty ?? "",
  };
}

/** Same normalisation as the server, so "changed" here means changed there. */
function normalise(name: FieldName, value: string): string {
  if (name === "amount" || name === "vatAmount") return parseMoney(value) ?? `invalid:${value}`;
  if (name === "currency") return value.trim().toUpperCase();
  return value.trim();
}

function display(name: FieldName, v: FormValues): string {
  const value = v[name];
  if (name === "documentType") return DOCUMENT_TYPE_LABELS[value] ?? value;
  if (name === "documentDate") return value ? shortDate(value) + " " + value.slice(0, 4) : "Not stated";
  if (name === "amount" || name === "vatAmount") return value ? formatMoney(parseMoney(value) ?? null, v.currency) : "Not stated";
  return value || "Not stated";
}

const input =
  "field";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

function obligationLabel(o: LinkableObligation): string {
  const state = o.status === "OPEN" ? "open" : o.status === "COMPLETE" ? "already complete" : "waived";
  return `${o.typeName} for ${periodLabel(o.periodStart, o.periodEnd)}, due ${shortDate(o.dueDate)} (${state})`;
}

export function ReviewForm({
  documentId,
  proposal,
  obligations,
}: {
  documentId: string;
  proposal: { fields: ClassificationFields; confidence: number | null; modelUsed: string | null; source?: "LLM" | "HUMAN"; createdBy?: string };
  obligations: LinkableObligation[];
}) {
  const original = useMemo(() => toFormValues(proposal.fields), [proposal.fields]);
  const [values, setValues] = useState<FormValues>(original);
  const [editing, setEditing] = useState(false);
  const [obligationChoice, setObligationChoice] = useState<string | null>(null); // null = follow the suggestion
  const [state, confirm] = useActionState(confirmAction, { status: "idle" } as ReviewState);
  const [rejectState, reject] = useActionState(rejectAction, { status: "idle" } as ReviewState);

  const changed = (Object.keys(LABELS) as FieldName[]).filter((k) => normalise(k, values[k]) !== normalise(k, original[k]));

  // Re-run the deterministic matcher on the CURRENT (possibly corrected) type and date.
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(values.documentDate) ? values.documentDate : null;
  const match = matchObligations({ documentType: values.documentType as DocumentType, documentDate: validDate }, obligations);
  const choiceStillValid = obligationChoice === "" || match.candidates.some((c) => c.id === obligationChoice);
  const selectedId = obligationChoice !== null && choiceStillValid ? obligationChoice : (match.suggestedId ?? "");
  const selected = match.candidates.find((c) => c.id === selectedId);

  const set = (name: FieldName) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));
  const fieldError = (name: FieldName) => (state.status === "error" ? state.fieldErrors?.[name] : undefined);

  const confidence = proposal.confidence;
  // Eigenbelege are entered by staff, not proposed by the model: word the form accordingly.
  const byStaff = proposal.source === "HUMAN";
  const lowConfidence = confidence !== null && confidence < 0.8;

  return (
    <div className="space-y-8">
      <form action={confirm} className="card overflow-hidden">
        <input type="hidden" name="documentId" value={documentId} />

        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-soft px-5 py-3">
          <h2 className="font-semibold">{editing ? (byStaff ? "Correct the entry" : "Correct the proposal") : byStaff ? `Entered by ${proposal.createdBy ?? "staff"}` : "The model's proposal"}</h2>
          {confidence !== null && (
            <p className={`text-sm ${lowConfidence ? "font-medium text-amber" : "text-ink-muted"}`}>
              Model confidence {Math.round(confidence * 100)} %{lowConfidence && ", check carefully"}
            </p>
          )}
        </div>

        <div className="px-5 py-4">
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {(Object.keys(LABELS) as FieldName[]).map((name) => (
                <label key={name} className={`block text-sm text-ink-muted ${name === "counterparty" ? "sm:col-span-2" : ""}`}>
                  {LABELS[name]}
                  {name === "documentType" ? (
                    <select name={name} value={values[name]} onChange={set(name)} className={input}>
                      {DOCUMENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {DOCUMENT_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      name={name}
                      type={name === "documentDate" ? "date" : "text"}
                      inputMode={name === "amount" || name === "vatAmount" ? "decimal" : undefined}
                      value={values[name]}
                      onChange={set(name)}
                      placeholder={name === "amount" || name === "vatAmount" ? "e.g. 1.234,56 (empty if not stated)" : undefined}
                      aria-invalid={fieldError(name) ? true : undefined}
                      className={input}
                    />
                  )}
                  {changed.includes(name) && (
                    <span className="mt-1 block text-stamp">
                      {byStaff ? "Entered as" : "Model said"}: {display(name, original)}
                    </span>
                  )}
                  {fieldError(name) && <span className="mt-1 block text-red">{fieldError(name)}</span>}
                </label>
              ))}
            </div>
          ) : (
            <>
              {(Object.keys(LABELS) as FieldName[]).map((name) => (
                <input key={name} type="hidden" name={name} value={values[name]} />
              ))}
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5">
                {(Object.keys(LABELS) as FieldName[]).map((name) => (
                  <div key={name} className="contents">
                    <dt className="text-sm text-ink-muted">{LABELS[name]}</dt>
                    <dd className="font-medium">{display(name, values)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>

        <div className="border-t border-rule-soft bg-stamp-wash px-5 py-4">
          <label className="block text-sm font-medium text-stamp">
            Counts towards
            <select
              name="obligationId"
              value={selectedId}
              onChange={(e) => setObligationChoice(e.target.value)}
              className={`${input} font-normal`}
            >
              <option value="">Don&rsquo;t link to an obligation</option>
              {match.candidates.map((o) => (
                <option key={o.id} value={o.id}>
                  {obligationLabel(o)}
                </option>
              ))}
            </select>
          </label>
          {selectedId !== "" && selectedId === match.suggestedId && (
            <p className="mt-2 text-sm text-ink-muted">Suggested from the document type and date. Change it if it is wrong.</p>
          )}
          {match.candidates.length === 0 && (
            <p className="mt-2 text-sm text-ink-muted">No obligation of this client accepts this document type.</p>
          )}
          {selected?.requiresManualCompletion && selected.status === "OPEN" && (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" name="closePeriod" className="mt-0.5 size-4 accent-brand" />
              <span>
                This is the last one: close {selected.typeName} for {periodLabel(selected.periodStart, selected.periodEnd)}.
              </span>
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-rule-soft px-5 py-4">
          <SubmitButton label={changed.length > 0 ? `Save correction and confirm` : "Confirm"} />
          {editing ? (
            <button
              type="button"
              onClick={() => {
                setValues(original);
                setEditing(false);
              }}
              className="brand-link px-2 py-2 text-sm"
            >
              Discard corrections
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn-secondary"
            >
              Correct
            </button>
          )}
          {changed.length > 0 && (
            <p className="text-sm text-ink-muted">
              {changed.length} field{changed.length === 1 ? "" : "s"} corrected. {byStaff ? "The original entry is kept unchanged." : "The model’s proposal is kept unchanged for accuracy tracking."}
            </p>
          )}
        </div>
        {state.status === "error" && (
          <p role="alert" className="border-t border-rule-soft bg-red-wash px-5 py-3 text-red">
            {state.message}
          </p>
        )}
      </form>

      <details className="card rounded-card-sm overflow-hidden">
        <summary className="cursor-pointer px-5 py-3 text-sm text-ink-muted">Wrong or unusable document? Reject it</summary>
        <form action={reject} className="space-y-3 border-t border-rule-soft px-5 py-4">
          <input type="hidden" name="documentId" value={documentId} />
          <label className="block text-sm text-ink-muted">
            Reason (kept in the audit log)
            <input name="reason" required minLength={3} className={input} placeholder="e.g. Photo unreadable, client asked to resend" />
          </label>
          <button type="submit" className="btn-danger">
            Reject document
          </button>
          {rejectState.status === "error" && (
            <p role="alert" className="text-red">
              {rejectState.message}
            </p>
          )}
        </form>
      </details>
    </div>
  );
}
