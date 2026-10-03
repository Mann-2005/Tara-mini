import { describe, expect, it } from "vitest";
import type { ClassificationFields } from "../classificationFields";
import { computeAccuracy, type ReviewedPair } from "./computeAccuracy";

const INVOICE: ClassificationFields = {
  documentType: "INCOMING_INVOICE",
  documentDate: "2026-09-15",
  amount: "8925.00",
  vatAmount: "1425.00",
  currency: "EUR",
  counterparty: "Krämer",
};
const STATEMENT: ClassificationFields = {
  documentType: "BANK_STATEMENT",
  documentDate: "2026-09-30",
  amount: null,
  vatAmount: null,
  currency: "EUR",
  counterparty: "Sparkasse",
};

let n = 0;
function pair(confirmed: ClassificationFields, proposedOverrides: Partial<ClassificationFields> = {}, confidence: number | null = 0.95): ReviewedPair {
  n++;
  return {
    documentId: `d${n}`,
    filename: `doc${n}.pdf`,
    clientName: "Client",
    reviewedAt: `2026-10-0${(n % 9) + 1}T10:00:00.000Z`,
    modelUsed: "gemini-3.8-flash",
    confidence,
    proposed: { ...confirmed, ...proposedOverrides },
    confirmed,
  };
}

describe("computeAccuracy", () => {
  it("empty input → nothing measured, ratios are null (not 0 %)", () => {
    const r = computeAccuracy([]);
    expect(r.documents).toEqual({ correct: 0, total: 0, ratio: null });
    expect(r.byType).toEqual([]);
    expect(r.fields.every((f) => f.rate.ratio === null)).toBe(true);
  });

  it("document accuracy: a document is right only if every field is right", () => {
    const r = computeAccuracy([pair(INVOICE), pair(INVOICE, { amount: "7500.00" }), pair(STATEMENT), pair(STATEMENT)]);
    expect(r.documents).toEqual({ correct: 3, total: 4, ratio: 0.75 });
  });

  it("field accuracy counts each field separately", () => {
    const r = computeAccuracy([pair(INVOICE, { amount: "7500.00", counterparty: "Weber" }), pair(INVOICE)]);
    const byField = Object.fromEntries(r.fields.map((f) => [f.field, f.rate.ratio]));
    expect(byField).toEqual({ documentType: 1, documentDate: 1, amount: 0.5, vatAmount: 1, currency: 1, counterparty: 0.5 });
  });

  it("groups by the TRUE (confirmed) type, not the model's guess", () => {
    // Model called an invoice a receipt: it belongs to the invoice row, and is wrong there.
    const r = computeAccuracy([pair(INVOICE, { documentType: "RECEIPT" }), pair(INVOICE), pair(STATEMENT)]);
    expect(r.byType.map((t) => t.documentType)).toEqual(["INCOMING_INVOICE", "BANK_STATEMENT"]); // most reviewed first
    expect(r.byType[0]).toMatchObject({
      documents: { correct: 1, total: 2, ratio: 0.5 },
      typeIdentified: { correct: 1, total: 2 },
      mostCorrectedField: "documentType",
    });
    expect(r.byType.find((t) => t.documentType === "RECEIPT")).toBeUndefined();
  });

  it("type identified can be right while other fields are wrong", () => {
    const r = computeAccuracy([pair(INVOICE, { counterparty: "Weber" })]);
    expect(r.byType[0]).toMatchObject({ documents: { ratio: 0 }, typeIdentified: { ratio: 1 }, mostCorrectedField: "counterparty" });
  });

  it("lists type confusions with counts, most frequent first", () => {
    const r = computeAccuracy([
      pair(INVOICE, { documentType: "RECEIPT" }),
      pair(INVOICE, { documentType: "RECEIPT" }),
      pair(STATEMENT, { documentType: "OTHER" }),
      pair(STATEMENT),
    ]);
    expect(r.misclassifications).toEqual([
      { proposed: "RECEIPT", confirmed: "INCOMING_INVOICE", count: 2 },
      { proposed: "OTHER", confirmed: "BANK_STATEMENT", count: 1 },
    ]);
  });

  it("bands documents by the model's confidence", () => {
    const r = computeAccuracy([
      pair(INVOICE, {}, 0.97),
      pair(INVOICE, { amount: "1.00" }, 0.95),
      pair(INVOICE, { amount: "1.00" }, 0.62),
      pair(INVOICE, {}, null),
    ]);
    expect(Object.fromEntries(r.confidence.map((b) => [b.label, [b.documents.correct, b.documents.total]]))).toEqual({
      "90 % or more": [1, 2],
      "80 to 89 %": [0, 0],
      "Below 80 %": [0, 1],
      "Not stated": [1, 1],
    });
  });

  it("lists corrections with the changed fields, most recent first", () => {
    const older = { ...pair(INVOICE, { amount: "1.00" }), reviewedAt: "2026-10-01T09:00:00.000Z" };
    const newer = { ...pair(STATEMENT, { counterparty: "X" }), reviewedAt: "2026-10-02T09:00:00.000Z" };
    const r = computeAccuracy([older, pair(INVOICE), newer]);
    expect(r.corrections.map((c) => [c.documentId, c.changed])).toEqual([
      [newer.documentId, ["counterparty"]],
      [older.documentId, ["amount"]],
    ]);
  });

  it("is deterministic and independent of input order", () => {
    const pairs = [pair(INVOICE, { documentType: "RECEIPT" }), pair(STATEMENT), pair(INVOICE, { amount: "2.00" }, 0.7), pair(STATEMENT, { documentType: "OTHER" })];
    expect(computeAccuracy([...pairs].reverse())).toEqual(computeAccuracy(pairs));
  });
});
