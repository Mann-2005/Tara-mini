import { describe, expect, it } from "vitest";
import type { AnalyticsDocument } from "./types";
import { computeRunningVatLiability } from "./vatLiability";

let n = 0;
function doc(documentType: AnalyticsDocument["documentType"], date: string | null, vat: string | null, overrides: Partial<AnalyticsDocument> = {}): AnalyticsDocument {
  n++;
  return {
    documentId: `d${n}`,
    clientId: "mueller",
    status: "CONFIRMED",
    documentType,
    documentDate: date,
    amount: null,
    vatAmount: vat,
    currency: "EUR",
    counterparty: "X",
    ...overrides,
  };
}

const SEPT = { start: "2026-09-01", end: "2026-09-30" };
const Q3 = { start: "2026-07-01", end: "2026-09-30" };

describe("computeRunningVatLiability — direction", () => {
  it("output VAT above input VAT → Zahllast (PAYABLE)", () => {
    const r = computeRunningVatLiability(
      [doc("OUTGOING_INVOICE", "2026-09-05", "1900.00"), doc("INCOMING_INVOICE", "2026-09-10", "1425.00")],
      SEPT,
      "2026-09-30",
    );
    expect(r).toMatchObject({ outputVatCents: 190000, inputVatCents: 142500, netCents: 47500, position: "PAYABLE", counted: { input: 1, output: 1 } });
  });

  it("input VAT above output VAT → Guthaben (REFUND)", () => {
    const r = computeRunningVatLiability([doc("INCOMING_INVOICE", "2026-09-10", "1425.00"), doc("OUTGOING_INVOICE", "2026-09-12", "95.00")], SEPT, "2026-09-30");
    expect(r).toMatchObject({ netCents: -133000, position: "REFUND" });
  });

  it("nothing counted → ZERO", () => {
    expect(computeRunningVatLiability([], SEPT, "2026-09-15")).toMatchObject({ netCents: 0, position: "ZERO", counted: { input: 0, output: 0 } });
  });

  it("purchase receipts are input VAT (Vorsteuer), not output", () => {
    const r = computeRunningVatLiability([doc("RECEIPT", "2026-09-22", "14.62")], SEPT, "2026-09-30");
    expect(r).toMatchObject({ inputVatCents: 1462, outputVatCents: 0, netCents: -1462, position: "REFUND" });
  });

  it("credit notes (negative VAT) net off naturally", () => {
    const r = computeRunningVatLiability(
      [doc("OUTGOING_INVOICE", "2026-09-05", "1900.00"), doc("OUTGOING_INVOICE", "2026-09-06", "-190.00")],
      SEPT,
      "2026-09-30",
    );
    expect(r.outputVatCents).toBe(171000);
  });

  it("sums exactly in cents (no floating-point drift)", () => {
    const docs = Array.from({ length: 10 }, () => doc("INCOMING_INVOICE", "2026-09-10", "0.10"));
    expect(computeRunningVatLiability(docs, SEPT, "2026-09-30").inputVatCents).toBe(100);
  });
});

describe("computeRunningVatLiability — which documents count", () => {
  it("only documents dated inside the period and on or before the as-of date (time travel)", () => {
    const docs = [
      doc("OUTGOING_INVOICE", "2026-08-31", "100.00"), // before the period
      doc("OUTGOING_INVOICE", "2026-09-01", "200.00"), // first day: counts
      doc("OUTGOING_INVOICE", "2026-09-15", "300.00"), // = asOf: counts
      doc("OUTGOING_INVOICE", "2026-09-16", "400.00"), // after asOf
      doc("OUTGOING_INVOICE", "2026-10-01", "500.00"), // after the period
    ];
    const r = computeRunningVatLiability(docs, SEPT, "2026-09-15");
    expect(r).toMatchObject({ outputVatCents: 50000, countedUntil: "2026-09-15", periodComplete: false, periodStarted: true });
  });

  it("a quarterly period counts all three months", () => {
    const docs = [doc("OUTGOING_INVOICE", "2026-07-02", "10.00"), doc("OUTGOING_INVOICE", "2026-08-02", "10.00"), doc("OUTGOING_INVOICE", "2026-09-02", "10.00")];
    expect(computeRunningVatLiability(docs, Q3, "2026-10-02")).toMatchObject({ outputVatCents: 3000, countedUntil: "2026-09-30", periodComplete: true });
  });

  it("as-of before the period: nothing counted, period not started", () => {
    const r = computeRunningVatLiability([doc("OUTGOING_INVOICE", "2026-09-05", "1900.00")], SEPT, "2026-08-20");
    expect(r).toMatchObject({ periodStarted: false, periodComplete: false, outputVatCents: 0, countedUntil: "2026-08-20" });
  });

  it("ignores proposals, undated documents and types without VAT of their own", () => {
    const r = computeRunningVatLiability(
      [
        doc("OUTGOING_INVOICE", "2026-09-05", "1900.00", { status: "PROPOSED" }),
        doc("INCOMING_INVOICE", null, "50.00"),
        doc("BANK_STATEMENT", "2026-09-30", "999.00"),
        doc("PAYROLL_DATA", "2026-09-10", "1.00"),
        doc("ELSTER_RECEIPT", "2026-09-09", "2140.55"),
        doc("OTHER", "2026-09-09", "3.00"),
      ],
      SEPT,
      "2026-09-30",
    );
    expect(r).toMatchObject({ inputVatCents: 0, outputVatCents: 0, counted: { input: 0, output: 0 }, notCounted: { missingVat: 0, foreignCurrency: 0 } });
  });

  it("reports relevant documents it could not count: missing VAT, foreign currency", () => {
    const r = computeRunningVatLiability(
      [
        doc("INCOMING_INVOICE", "2026-09-10", null),
        doc("OUTGOING_INVOICE", "2026-09-11", null),
        doc("INCOMING_INVOICE", "2026-09-12", "19.00", { currency: "USD" }),
        doc("INCOMING_INVOICE", "2026-09-13", "38.00"),
      ],
      SEPT,
      "2026-09-30",
    );
    expect(r).toMatchObject({ inputVatCents: 3800, counted: { input: 1, output: 0 }, notCounted: { missingVat: 2, foreignCurrency: 1 } });
  });

  it("an Eigenbeleg (receipt with 0 VAT) adds nothing but is counted", () => {
    const r = computeRunningVatLiability([doc("RECEIPT", "2026-09-10", "0.00")], SEPT, "2026-09-30");
    expect(r).toMatchObject({ inputVatCents: 0, counted: { input: 1 }, position: "ZERO" });
  });
});

describe("computeRunningVatLiability — contract", () => {
  it("is independent of input order", () => {
    const docs = [doc("OUTGOING_INVOICE", "2026-09-05", "1900.00"), doc("RECEIPT", "2026-09-22", "14.62"), doc("INCOMING_INVOICE", "2026-09-10", null)];
    expect(computeRunningVatLiability([...docs].reverse(), SEPT, "2026-09-30")).toEqual(computeRunningVatLiability(docs, SEPT, "2026-09-30"));
  });

  it("rejects a period that ends before it starts", () => {
    expect(() => computeRunningVatLiability([], { start: "2026-09-30", end: "2026-09-01" }, "2026-09-15")).toThrow(/starts after it ends/);
  });
});
