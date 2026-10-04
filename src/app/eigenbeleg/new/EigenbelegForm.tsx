"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { MISSING_REASONS, SMALL_AMOUNT_LIMIT_CENTS, type MissingReason } from "@/domain/eigenbeleg/eigenbeleg";
import { parseMoney, toCents } from "@/domain/money";
import { createEigenbelegAction, type EigenbelegFormState } from "../actions";

export interface EligibleObligation {
  id: string;
  clientName: string;
  label: string;
  periodStart: string;
  periodEnd: string;
}

export interface EigenbelegDefaults {
  obligationId: string;
  payee: string;
  amount: string;
  expenseDate: string;
}

const REASON_LABELS: Record<MissingReason, string> = {
  LOST: "Receipt lost (Originalbeleg verloren)",
  NO_RECEIPT_ISSUED: "No receipt available, e.g. vending machine or parking meter",
  ILLEGIBLE: "Receipt illegible (unleserlich)",
  OTHER: "Other reason",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Creating the voucher…" : "Create Eigenbeleg"}
    </button>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm text-ink-muted">
      {label}
      {children}
      {hint && !error && <span className="mt-1 block">{hint}</span>}
      {error && <span className="mt-1 block text-red">{error}</span>}
    </label>
  );
}

export function EigenbelegForm({ obligations, defaults }: { obligations: EligibleObligation[]; defaults: EigenbelegDefaults }) {
  const [state, action] = useActionState(createEigenbelegAction, { status: "idle" } as EigenbelegFormState);
  const [obligationId, setObligationId] = useState(defaults.obligationId);
  const [amount, setAmount] = useState(defaults.amount);
  const [reason, setReason] = useState<MissingReason>("LOST");
  const [signature, setSignature] = useState<"wet" | "digital">("wet");
  const errors = state.status === "error" ? state.fieldErrors : {};

  const selected = obligations.find((o) => o.id === obligationId);
  const parsed = parseMoney(amount);
  const large = parsed ? toCents(parsed) > SMALL_AMOUNT_LIMIT_CENTS : false;

  return (
    <form action={action} className="card overflow-hidden">
      <section className="space-y-4 px-5 py-5">
        <h2 className="font-semibold">What was paid</h2>
        <Field label="Counts towards" error={errors.obligationId}>
          <select name="obligationId" value={obligationId} onChange={(e) => setObligationId(e.target.value)} required className="field">
            <option value="" disabled>
              Choose the client and period
            </option>
            {obligations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.clientName}: {o.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date of the expense" error={errors.expenseDate} hint={selected ? `Must fall within ${selected.label}.` : undefined}>
            <input type="date" name="expenseDate" defaultValue={defaults.expenseDate} min={selected?.periodStart} max={selected?.periodEnd} required className="field" />
          </Field>
          <Field label="Amount paid (gross)" error={errors.grossAmount}>
            <input name="grossAmount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 47,60" required className="field" />
          </Field>
        </div>
        {large && (
          <p className="border-l-4 border-amber bg-amber-wash px-4 py-2 text-sm">
            Over 250 EUR: tax offices accept Eigenbelege mainly for small amounts. Ask the vendor for a duplicate invoice first if at all possible.
          </p>
        )}
        <Field label="Paid to (vendor or person)" error={errors.payee}>
          <input name="payee" defaultValue={defaults.payee} required className="field" />
        </Field>
        <Field label="What was bought or paid for" error={errors.description}>
          <input name="description" required placeholder="e.g. Parking fee for the site meeting in Essen" className="field" />
        </Field>
      </section>

      <section className="space-y-4 border-t border-rule-soft px-5 py-5">
        <h2 className="font-semibold">Why there is no original receipt</h2>
        <Field label="Reason" error={errors.reason}>
          <select name="reason" value={reason} onChange={(e) => setReason(e.target.value as MissingReason)} className="field">
            {(Object.keys(MISSING_REASONS) as MissingReason[]).map((r) => (
              <option key={r} value={r}>
                {REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={reason === "OTHER" ? "Explain the reason" : "Details (optional)"} error={errors.reasonDetail}>
          <input name="reasonDetail" required={reason === "OTHER"} className="field" />
        </Field>
        <Field label="Business purpose (betrieblicher Anlass)" error={errors.businessPurpose} hint="Why the expense was necessary for the business, in a sentence.">
          <textarea name="businessPurpose" rows={2} required className="field" />
        </Field>
      </section>

      <section className="space-y-3 border-t border-rule-soft bg-stamp-wash px-5 py-5">
        <h2 className="font-semibold text-brand">VAT</h2>
        <p className="text-sm">
          An Eigenbeleg is not an invoice under § 14 UStG, so <strong>no input VAT (Vorsteuer) can be deducted</strong> (§ 15 Abs. 1 Nr. 1 UStG). The
          full amount{parsed ? ` of ${Number(parsed).toLocaleString("de-DE", { minimumFractionDigits: 2 })} EUR` : ""} is booked as a business expense, with
          0,00 EUR VAT.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="noVat" required defaultChecked className="mt-0.5 size-4 accent-brand" />
          <span>Book without input VAT deduction (0 % deductible)</span>
        </label>
        {errors.noVat && <p className="text-sm text-red">{errors.noVat}</p>}
      </section>

      <section className="space-y-3 border-t border-rule-soft px-5 py-5">
        <h2 className="font-semibold">Signature</h2>
        <fieldset className="space-y-2 text-sm">
          <legend className="sr-only">How the client confirms the voucher</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="signature" value="wet" checked={signature === "wet"} onChange={() => setSignature("wet")} className="mt-0.5 accent-brand" />
            <span>Print the voucher and have the client sign it</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="signature" value="digital" checked={signature === "digital"} onChange={() => setSignature("digital")} className="mt-0.5 accent-brand" />
            <span>The client has confirmed the details digitally (e.g. by email)</span>
          </label>
        </fieldset>
        {signature === "digital" && (
          <Field label="Confirmed by" error={errors.digitallyConfirmedBy}>
            <input name="confirmedBy" required placeholder="Name of the person who paid" className="field" />
          </Field>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule-soft px-5 py-4">
        <Submit />
        <p className="text-sm text-ink-muted">Saved as a draft. It counts only after you confirm it on the review page.</p>
      </div>
      {state.status === "error" && (
        <p role="alert" className="border-t border-rule-soft bg-red-wash px-5 py-3 text-red">
          {state.message}
        </p>
      )}
    </form>
  );
}
