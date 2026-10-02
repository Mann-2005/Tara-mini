import { describe, expect, it } from "vitest";
import { changedFields, fieldsFromRow, parseMoney, parseReviewedFields, type ClassificationFields } from "./fields";

const decimal = (s: string) => ({ toFixed: (d: number) => Number(s).toFixed(d) });

const LLM: ClassificationFields = {
  documentType: "INCOMING_INVOICE",
  documentDate: "2026-09-15",
  amount: "8925.00",
  vatAmount: "1425.00",
  currency: "EUR",
  counterparty: "Baustoffhandel Krämer GmbH",
};

const form = (overrides: Record<string, string> = {}) => ({
  documentType: "INCOMING_INVOICE",
  documentDate: "2026-09-15",
  amount: "8.925,00",
  vatAmount: "1425",
  currency: "eur",
  counterparty: "  Baustoffhandel Krämer GmbH ",
  ...overrides,
});

describe("parseMoney", () => {
  it.each([
    ["8.925,00", "8925.00"],
    ["8925.00", "8925.00"],
    ["8925", "8925.00"],
    ["91,54 €", "91.54"],
    ["-12,5", "-12.50"],
    ["", null],
  ])("%s → %s", (input, expected) => expect(parseMoney(input)).toBe(expected));

  it("rejects nonsense", () => {
    expect(parseMoney("12,345,6")).toBeUndefined();
    expect(parseMoney("abc")).toBeUndefined();
    expect(parseMoney("1.5.5")).toBeUndefined();
  });
});

describe("parseReviewedFields", () => {
  it("normalises German money, currency case and whitespace", () => {
    expect(parseReviewedFields(form())).toEqual({ ok: true, fields: LLM });
  });

  it("empty optional fields become null", () => {
    const r = parseReviewedFields(form({ documentDate: "", amount: "", vatAmount: "", counterparty: "" }));
    expect(r).toMatchObject({ ok: true, fields: { documentDate: null, amount: null, vatAmount: null, counterparty: null } });
  });

  it("reports every invalid field", () => {
    const r = parseReviewedFields(form({ documentDate: "2026-02-30", amount: "lots" }));
    expect(r).toEqual({ ok: false, errors: { documentDate: expect.any(String), amount: expect.any(String) } });
  });

  it("rejects an unknown document type and a bad currency", () => {
    const r = parseReviewedFields(form({ documentType: "INVOICE", currency: "EURO" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["currency", "documentType"]);
  });
});

describe("changedFields", () => {
  const row = fieldsFromRow({
    documentType: "INCOMING_INVOICE",
    documentDate: new Date("2026-09-15T00:00:00Z"),
    amount: decimal("8925"),
    vatAmount: decimal("1425"),
    currency: "EUR",
    counterparty: "Baustoffhandel Krämer GmbH",
  });

  it("a DB row and the same values typed by a reviewer are identical", () => {
    const r = parseReviewedFields(form());
    expect(r.ok && changedFields(row, r.fields)).toEqual([]);
  });

  it("lists exactly the corrected fields", () => {
    const r = parseReviewedFields(form({ documentType: "RECEIPT", amount: "7.500,00" }));
    expect(r.ok && changedFields(row, r.fields)).toEqual(["documentType", "amount"]);
  });
});
