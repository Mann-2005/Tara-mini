import { describe, expect, it } from "vitest";
import { detectGhostInvoices } from "./ghostInvoices";
import type { AnalyticsDocument } from "./types";

let n = 0;
function doc(date: string | null, counterparty: string | null, overrides: Partial<AnalyticsDocument> = {}): AnalyticsDocument {
  n++;
  return {
    documentId: `d${String(n).padStart(4, "0")}`,
    clientId: "weber",
    status: "CONFIRMED",
    documentType: "INCOMING_INVOICE",
    documentDate: date,
    amount: "47.60",
    vatAmount: "7.60",
    currency: "EUR",
    counterparty,
    ...overrides,
  };
}

const SEP = "2026-09-01"; // current period → lookback Jun, Jul, Aug
const detect = (docs: AnalyticsDocument[], options = {}) => detectGhostInvoices("weber", SEP, docs, options);

describe("detectGhostInvoices — recurrence", () => {
  it("vendor in 2 of the 3 preceding months, nothing this month → ghost", () => {
    const ghosts = detect([doc("2026-07-03", "Telefónica Germany GmbH & Co. OHG"), doc("2026-08-03", "Telefónica Germany GmbH & Co. OHG")]);
    expect(ghosts).toEqual([
      {
        vendorKey: "telefonica germany",
        displayName: "Telefónica Germany GmbH & Co. OHG",
        monthsSeen: ["2026-07", "2026-08"],
        expectedAmountCents: 4760,
        lastSeenDate: "2026-08-03",
      },
    ]);
  });

  it("vendor in all 3 months → ghost", () => {
    expect(detect([doc("2026-06-03", "O2"), doc("2026-07-03", "O2"), doc("2026-08-03", "O2")])).toHaveLength(1);
  });

  it("vendor in only 1 of 3 months → not recurring", () => {
    expect(detect([doc("2026-08-03", "Baumarkt Hornbach")])).toEqual([]);
  });

  it("documents older than the lookback window are ignored", () => {
    // May and April are outside Jun–Aug.
    expect(detect([doc("2026-04-03", "O2"), doc("2026-05-03", "O2"), doc("2026-08-03", "O2")])).toEqual([]);
  });

  it("a longer lookback (6 months) can find a vendor the default misses", () => {
    const docs = [doc("2026-04-03", "O2"), doc("2026-05-03", "O2"), doc("2026-08-03", "O2")];
    expect(detect(docs, { lookbackMonths: 6 })[0].monthsSeen).toEqual(["2026-04", "2026-05", "2026-08"]);
  });

  it("minMonths is configurable", () => {
    expect(detect([doc("2026-08-03", "O2")], { minMonths: 1 })).toHaveLength(1);
  });

  it("looks across the year boundary (January looks at Oct–Dec)", () => {
    const ghosts = detectGhostInvoices("weber", "2027-01-01", [doc("2026-11-02", "Hetzner Online GmbH"), doc("2026-12-02", "Hetzner Online GmbH")]);
    expect(ghosts.map((g) => g.monthsSeen)).toEqual([["2026-11", "2026-12"]]);
  });

  it("uses the month of currentPeriodStart even if it is not the 1st", () => {
    expect(detectGhostInvoices("weber", "2026-09-17", [doc("2026-07-03", "O2"), doc("2026-08-03", "O2")])).toHaveLength(1);
  });
});

describe("detectGhostInvoices — has it arrived this month?", () => {
  const history = [doc("2026-07-03", "O2"), doc("2026-08-03", "O2")];

  it("a confirmed document this month → no ghost", () => {
    expect(detect([...history, doc("2026-09-03", "O2")])).toEqual([]);
  });

  it("an unreviewed (proposed) document this month also counts as arrived", () => {
    expect(detect([...history, doc("2026-09-03", "O2", { status: "PROPOSED" })])).toEqual([]);
  });

  it("a document the model misfiled as OTHER still counts as arrived", () => {
    expect(detect([...history, doc("2026-09-03", "O2", { status: "PROPOSED", documentType: "OTHER" })])).toEqual([]);
  });

  it("an outgoing invoice TO that party does not count as the expected bill", () => {
    expect(detect([...history, doc("2026-09-03", "O2", { documentType: "OUTGOING_INVOICE" })])).toHaveLength(1);
  });

  it("matches spelling variants between history and this month", () => {
    expect(
      detect([doc("2026-07-03", "Telefónica Germany GmbH & Co. OHG"), doc("2026-08-03", "Telefonica Germany"), doc("2026-09-02", "TELEFONICA GERMANY GMBH")]),
    ).toEqual([]);
  });
});

describe("detectGhostInvoices — what counts as history", () => {
  it("only CONFIRMED documents build history (proposals are not evidence of recurrence)", () => {
    expect(detect([doc("2026-07-03", "O2", { status: "PROPOSED" }), doc("2026-08-03", "O2", { status: "PROPOSED" })])).toEqual([]);
  });

  it("receipts count as expense documents", () => {
    expect(detect([doc("2026-07-10", "Aral", { documentType: "RECEIPT" }), doc("2026-08-11", "Aral", { documentType: "RECEIPT" })])).toHaveLength(1);
  });

  it("ignores non-expense types, other clients, and documents without date or counterparty", () => {
    expect(
      detect([
        doc("2026-07-03", "Kunde Meyer", { documentType: "OUTGOING_INVOICE" }),
        doc("2026-08-03", "Kunde Meyer", { documentType: "OUTGOING_INVOICE" }),
        doc("2026-07-31", "Sparkasse", { documentType: "BANK_STATEMENT" }),
        doc("2026-08-31", "Sparkasse", { documentType: "BANK_STATEMENT" }),
        doc("2026-07-03", "O2", { clientId: "mueller" }),
        doc("2026-08-03", "O2", { clientId: "mueller" }),
        doc(null, "O2"),
        doc("2026-08-03", null),
        doc("2026-07-03", "GmbH & Co. KG"), // empty vendor key
        doc("2026-08-03", "GmbH & Co. KG"),
      ]),
    ).toEqual([]);
  });
});

describe("detectGhostInvoices — expected amount", () => {
  it("is the mean of monthly totals (two invoices in one month are added first)", () => {
    const ghosts = detect([
      doc("2026-07-03", "O2", { amount: "40.00" }),
      doc("2026-07-20", "O2", { amount: "10.00" }), // July total 50.00
      doc("2026-08-03", "O2", { amount: "45.01" }),
    ]);
    expect(ghosts[0].expectedAmountCents).toBe(4751); // (5000 + 4501) / 2 = 4750.5 → half-up 4751
  });

  it("months with unknown amounts still count as seen, but not in the average", () => {
    const ghosts = detect([doc("2026-07-03", "O2", { amount: null }), doc("2026-08-03", "O2", { amount: "45.00" })]);
    expect(ghosts[0]).toMatchObject({ monthsSeen: ["2026-07", "2026-08"], expectedAmountCents: 4500 });
  });

  it("a month with one stated and one unstated amount uses the stated one", () => {
    const ghosts = detect([doc("2026-07-03", "O2", { amount: null }), doc("2026-07-04", "O2", { amount: "30.00" }), doc("2026-08-03", "O2", { amount: "30.00" })]);
    expect(ghosts[0].expectedAmountCents).toBe(3000);
  });

  it("an unstated amount after a stated one in the same month does not erase it", () => {
    const ghosts = detect([doc("2026-07-03", "O2", { amount: "30.00" }), doc("2026-07-04", "O2", { amount: null }), doc("2026-08-03", "O2", { amount: "30.00" })]);
    expect(ghosts[0].expectedAmountCents).toBe(3000);
  });

  it("null when no amount was ever stated", () => {
    expect(detect([doc("2026-07-03", "O2", { amount: null }), doc("2026-08-03", "O2", { amount: null })])[0].expectedAmountCents).toBeNull();
  });

  it("display name and last-seen date come from the most recent document (ties broken by id)", () => {
    const ghosts = detect([doc("2026-08-03", "Telefonica Germany"), doc("2026-07-03", "Telefónica Germany GmbH"), doc("2026-08-03", "TELEFONICA GERMANY")]);
    expect(ghosts[0]).toMatchObject({ displayName: "TELEFONICA GERMANY", lastSeenDate: "2026-08-03" });
  });
});

describe("detectGhostInvoices — ordering, determinism, validation", () => {
  const docs = [
    doc("2026-07-01", "Small Vendor", { amount: "10.00" }),
    doc("2026-08-01", "Small Vendor", { amount: "10.00" }),
    doc("2026-07-01", "Big Vendor", { amount: "900.00" }),
    doc("2026-08-01", "Big Vendor", { amount: "900.00" }),
    doc("2026-07-01", "Alpha Unknown", { amount: null }),
    doc("2026-08-01", "Alpha Unknown", { amount: null }),
    doc("2026-07-01", "Beta Same", { amount: "10.00" }),
    doc("2026-08-01", "Beta Same", { amount: "10.00" }),
  ];

  it("sorts by expected amount (largest first, unknown last), then vendor key", () => {
    expect(detect(docs).map((g) => g.vendorKey)).toEqual(["big vendor", "beta same", "small vendor", "alpha unknown"]);
  });

  it("is independent of input order", () => {
    expect(detect([...docs].reverse())).toEqual(detect(docs));
  });

  it.each([
    [{ lookbackMonths: 0 }, /lookbackMonths/],
    [{ lookbackMonths: 13 }, /lookbackMonths/],
    [{ lookbackMonths: 2.5 }, /lookbackMonths/],
    [{ minMonths: 0 }, /minMonths/],
    [{ minMonths: 4 }, /minMonths/],
    [{ minMonths: 1.5 }, /minMonths/],
  ])("rejects invalid options %j", (options, message) => {
    expect(() => detect([], options)).toThrow(message);
  });
});
