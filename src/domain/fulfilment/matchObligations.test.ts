import { describe, expect, it } from "vitest";
import { isLinkAllowed, matchObligations, type LinkableObligation } from "./matchObligations";

function ob(id: string, overrides: Partial<LinkableObligation>): LinkableObligation {
  return {
    id,
    typeCode: "KONTOAUSZUEGE",
    typeName: "Kontoauszüge",
    kind: "CLIENT_DELIVERY",
    acceptedDocumentTypes: ["BANK_STATEMENT"],
    requiresManualCompletion: false,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    dueDate: "2026-10-05",
    status: "OPEN",
    ...overrides,
  };
}

const KONTO_JUL = ob("konto-jul", { periodStart: "2026-07-01", periodEnd: "2026-07-31", status: "COMPLETE" });
const KONTO_AUG = ob("konto-aug", { periodStart: "2026-08-01", periodEnd: "2026-08-31" });
const KONTO_SEP = ob("konto-sep", {});
const EING_SEP = ob("eing-sep", {
  typeCode: "EINGANGSRECHNUNGEN",
  typeName: "Eingangsrechnungen",
  acceptedDocumentTypes: ["INCOMING_INVOICE", "RECEIPT"],
  requiresManualCompletion: true,
});
const USTVA_JUL = ob("ustva-jul", {
  typeCode: "USTVA",
  typeName: "Umsatzsteuervoranmeldung",
  kind: "FIRM_FILING",
  acceptedDocumentTypes: ["ELSTER_RECEIPT"],
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  status: "COMPLETE",
});
const USTVA_AUG = ob("ustva-aug", { ...USTVA_JUL, id: "ustva-aug", periodStart: "2026-08-01", periodEnd: "2026-08-31", status: "OPEN" });
const USTVA_SEP = ob("ustva-sep", { ...USTVA_JUL, id: "ustva-sep", periodStart: "2026-09-01", periodEnd: "2026-09-30", status: "OPEN" });
const WAIVED = ob("waived", { periodStart: "2026-06-01", periodEnd: "2026-06-30", status: "WAIVED" });

const ALL = [KONTO_JUL, KONTO_AUG, KONTO_SEP, EING_SEP, USTVA_JUL, USTVA_AUG, USTVA_SEP, WAIVED];

describe("matchObligations", () => {
  it("bank statement dated 30 Sep → suggests September Kontoauszüge", () => {
    const r = matchObligations({ documentType: "BANK_STATEMENT", documentDate: "2026-09-30" }, ALL);
    expect(r.suggestedId).toBe("konto-sep");
  });

  it("only offers obligations that accept the document type; open first, newest period first", () => {
    const r = matchObligations({ documentType: "BANK_STATEMENT", documentDate: "2026-09-30" }, ALL);
    expect(r.candidates.map((c) => c.id)).toEqual(["konto-sep", "konto-aug", "konto-jul"]);
  });

  it("never offers a waived obligation", () => {
    const r = matchObligations({ documentType: "BANK_STATEMENT", documentDate: "2026-06-30" }, ALL);
    expect(r.candidates.map((c) => c.id)).not.toContain("waived");
    expect(r.suggestedId).toBeNull(); // June has no open period → no guess
  });

  it("a receipt counts towards Eingangsrechnungen", () => {
    expect(matchObligations({ documentType: "RECEIPT", documentDate: "2026-09-22" }, ALL).suggestedId).toBe("eing-sep");
  });

  it("ELSTER receipt transmitted 9 Oct → the latest open UStVA period that ended before it (September)", () => {
    expect(matchObligations({ documentType: "ELSTER_RECEIPT", documentDate: "2026-10-09" }, ALL).suggestedId).toBe("ustva-sep");
  });

  it("ELSTER receipt transmitted 9 Sep → August (September has not ended yet)", () => {
    expect(matchObligations({ documentType: "ELSTER_RECEIPT", documentDate: "2026-09-09" }, ALL).suggestedId).toBe("ustva-aug");
  });

  it("no date → candidates but no suggestion", () => {
    const r = matchObligations({ documentType: "BANK_STATEMENT", documentDate: null }, ALL);
    expect(r.suggestedId).toBeNull();
    expect(r.candidates).toHaveLength(3);
  });

  it("OTHER documents match nothing", () => {
    expect(matchObligations({ documentType: "OTHER", documentDate: "2026-09-10" }, ALL)).toEqual({ candidates: [], suggestedId: null });
  });

  it("is independent of input order", () => {
    const doc = { documentType: "ELSTER_RECEIPT" as const, documentDate: "2026-10-09" };
    expect(matchObligations(doc, [...ALL].reverse())).toEqual(matchObligations(doc, ALL));
  });
});

describe("isLinkAllowed", () => {
  it("rejects a document type the obligation does not accept, and waived obligations", () => {
    expect(isLinkAllowed(KONTO_SEP, "INCOMING_INVOICE")).toBe(false);
    expect(isLinkAllowed(WAIVED, "BANK_STATEMENT")).toBe(false);
    expect(isLinkAllowed(KONTO_JUL, "BANK_STATEMENT")).toBe(true); // completed periods can take late documents
  });
});
