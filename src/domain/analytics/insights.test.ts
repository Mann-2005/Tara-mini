import { describe, expect, it } from "vitest";
import { computeClientInsights, selectVatObligation, type InsightObligation, type InsightsInput } from "./insights";
import type { AnalyticsDocument } from "./types";

const AS_OF = "2026-10-02";

let n = 0;
function ob(overrides: Partial<InsightObligation>): InsightObligation {
  n++;
  return {
    id: `o${String(n).padStart(3, "0")}`,
    typeCode: "KONTOAUSZUEGE",
    typeName: "Kontoauszüge",
    kind: "CLIENT_DELIVERY",
    status: "COMPLETE",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    dueDate: "2026-10-05",
    minDocuments: 1,
    completedAt: null,
    deliveryDates: [],
    acceptedDocumentTypes: ["BANK_STATEMENT"],
    ...overrides,
  };
}

const ustva = (start: string, end: string, due: string, status: InsightObligation["status"] = "OPEN") =>
  ob({ typeCode: "USTVA", typeName: "Umsatzsteuervoranmeldung", kind: "FIRM_FILING", acceptedDocumentTypes: ["ELSTER_RECEIPT"], periodStart: start, periodEnd: end, dueDate: due, status });

const eing = (start: string, end: string, due: string, status: InsightObligation["status"] = "OPEN") =>
  ob({ typeCode: "EINGANGSRECHNUNGEN", typeName: "Eingangsrechnungen", acceptedDocumentTypes: ["INCOMING_INVOICE", "RECEIPT"], periodStart: start, periodEnd: end, dueDate: due, status });

function doc(overrides: Partial<AnalyticsDocument>): AnalyticsDocument {
  n++;
  return {
    documentId: `d${n}`,
    clientId: "weber",
    status: "CONFIRMED",
    documentType: "INCOMING_INVOICE",
    documentDate: "2026-07-03",
    amount: "47.60",
    vatAmount: "7.60",
    currency: "EUR",
    counterparty: "Telefónica Germany GmbH & Co. OHG",
    ...overrides,
  };
}

describe("selectVatObligation", () => {
  it("picks the earliest open VAT return whose period has started", () => {
    const aug = ustva("2026-08-01", "2026-08-31", "2026-10-12");
    const sep = ustva("2026-09-01", "2026-09-30", "2026-11-10");
    const jul = ustva("2026-07-01", "2026-07-31", "2026-09-10", "COMPLETE");
    const oct = ustva("2026-10-03", "2026-10-31", "2026-12-10"); // not started at as-of
    expect(selectVatObligation([sep, oct, jul, aug], AS_OF)?.id).toBe(aug.id);
  });

  it("ties on due date are broken by period start, then id", () => {
    const later = ustva("2026-09-01", "2026-09-30", "2026-10-12");
    const earlier = ustva("2026-07-01", "2026-09-30", "2026-10-12");
    expect(selectVatObligation([later, earlier], AS_OF)?.id).toBe(earlier.id);
    const a = ustva("2026-09-01", "2026-09-30", "2026-10-12");
    const b = { ...a, id: "a-first" };
    expect(selectVatObligation([a, b], AS_OF)?.id).toBe("a-first");
  });

  it("ignores client deliveries and filings fulfilled by other document types", () => {
    const other = ob({ kind: "FIRM_FILING", acceptedDocumentTypes: ["OTHER"], status: "OPEN" });
    expect(selectVatObligation([ob({ status: "OPEN" }), other], AS_OF)).toBeNull();
  });

  it("null when every VAT return is filed", () => {
    expect(selectVatObligation([ustva("2026-07-01", "2026-09-30", "2026-10-12", "COMPLETE")], AS_OF)).toBeNull();
  });
});

describe("computeClientInsights", () => {
  const weberObligations = [
    ustva("2026-08-01", "2026-08-31", "2026-10-12"),
    eing("2026-08-01", "2026-08-31", "2026-10-05"),
    eing("2026-09-01", "2026-09-30", "2026-11-05"),
    eing("2026-07-01", "2026-07-31", "2026-09-07", "COMPLETE"),
    eing("2026-10-01", "2026-10-31", "2026-12-07"), // started on 1 Oct, so it is checked too
  ];
  const weberDocs = [
    doc({ documentDate: "2026-06-03" }),
    doc({ documentDate: "2026-07-03" }),
    doc({ documentDate: "2026-08-03" }),
    doc({ documentType: "OUTGOING_INVOICE", documentDate: "2026-08-20", amount: "23800.00", vatAmount: "3800.00", counterparty: "Bauherr Meyer" }),
  ];
  const input: InsightsInput = { client: { id: "weber", vatFilingFrequency: "MONTHLY" }, asOf: AS_OF, documents: weberDocs, obligations: weberObligations };

  it("forecasts VAT for the next return to file (August for Weber)", () => {
    const r = computeClientInsights(input);
    expect(r.vat).toMatchObject({
      obligationId: weberObligations[0].id,
      typeName: "Umsatzsteuervoranmeldung",
      dueDate: "2026-10-12",
      period: { start: "2026-08-01", end: "2026-08-31" },
      outputVatCents: 380000,
      inputVatCents: 760,
      netCents: 379240,
      position: "PAYABLE",
      periodComplete: true,
    });
  });

  it("flags the missing recurring vendor in each open invoice period, earliest first", () => {
    const r = computeClientInsights(input);
    // Aug: Telefónica arrived (3 Aug) → no ghost. Sep: seen Jun–Aug, nothing in Sep → ghost.
    // Oct: looks at Jul–Sep, seen Jul + Aug, nothing in Oct → ghost as well.
    expect(r.ghosts.map((g) => [g.periodStart, g.vendors.map((v) => v.displayName)])).toEqual([
      ["2026-09-01", ["Telefónica Germany GmbH & Co. OHG"]],
      ["2026-10-01", ["Telefónica Germany GmbH & Co. OHG"]],
    ]);
    expect(r.ghosts[0]).toMatchObject({ typeName: "Eingangsrechnungen", dueDate: "2026-11-05", periodEnd: "2026-09-30" });
  });

  it("does not check closed periods or periods that have not started", () => {
    const r = computeClientInsights({ ...input, asOf: "2026-09-15" });
    expect(r.ghosts.map((g) => g.periodStart)).toEqual(["2026-09-01"]);
  });

  it("no VAT forecast for VAT-exempt clients", () => {
    expect(computeClientInsights({ ...input, client: { id: "weber", vatFilingFrequency: "NONE" } }).vat).toBeNull();
  });

  it("no VAT forecast when nothing is left to file", () => {
    expect(computeClientInsights({ ...input, obligations: weberObligations.slice(1) }).vat).toBeNull();
  });

  it("includes the Compliance Score computed over the same obligations", () => {
    const r = computeClientInsights(input);
    expect(r.score).toMatchObject({ clientId: "weber", reason: "INSUFFICIENT_HISTORY" }); // only one client delivery is due by 2 Oct
    expect(r.clientId).toBe("weber");
  });

  it("is deterministic and independent of input order", () => {
    const reversed: InsightsInput = { ...input, documents: [...weberDocs].reverse(), obligations: [...weberObligations].reverse() };
    expect(computeClientInsights(reversed)).toEqual(computeClientInsights(input));
  });
});
