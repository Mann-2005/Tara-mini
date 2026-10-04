import { describe, expect, it } from "vitest";
import { buildVoucher, checkEigenbeleg, germanMoney, MISSING_REASONS, voucherText, type EigenbelegInput } from "./eigenbeleg";

const VALID: EigenbelegInput = {
  client: { name: "Weber Bau GmbH", clientNumber: "10003" },
  period: { start: "2026-09-01", end: "2026-09-30", label: "Eingangsrechnungen September 2026" },
  expenseDate: "2026-09-03",
  payee: "Telefónica Germany GmbH & Co. OHG",
  description: "O2 Business Mobilfunk, September 2026",
  grossAmount: "47.60",
  reason: "LOST",
  reasonDetail: "",
  businessPurpose: "Diensthandy des Bauleiters für Baustellenkommunikation",
  digitallyConfirmedBy: null,
  createdBy: "staff:demo",
  createdOn: "2026-10-04",
};

const check = (overrides: Partial<EigenbelegInput>) => checkEigenbeleg({ ...VALID, ...overrides });

describe("checkEigenbeleg", () => {
  it("a complete voucher has no errors or warnings", () => {
    expect(checkEigenbeleg(VALID)).toEqual({ errors: {}, warnings: [] });
  });

  it.each([
    [{ expenseDate: "" }, "expenseDate", /date of the expense/],
    [{ expenseDate: "2026-02-30" }, "expenseDate", /date of the expense/],
    [{ expenseDate: "2026-10-05" }, "expenseDate", /future/],
    [{ expenseDate: "2026-08-31" }, "expenseDate", /within Eingangsrechnungen September 2026/],
    [{ expenseDate: "2026-10-01", createdOn: "2026-10-04" }, "expenseDate", /within/],
    [{ payee: " " }, "payee", /who was paid/],
    [{ description: "x" }, "description", /what was bought/],
    [{ grossAmount: "abc" }, "grossAmount", /amount paid/],
    [{ grossAmount: "0.00" }, "grossAmount", /greater than zero/],
    [{ grossAmount: "-5.00" }, "grossAmount", /greater than zero/],
    [{ reason: "NONSENSE" as never }, "reason", /why the original/],
    [{ reason: "OTHER" as const, reasonDetail: "?" }, "reasonDetail", /Explain why/],
    [{ businessPurpose: "Handy" }, "businessPurpose", /business purpose/],
    [{ digitallyConfirmedBy: " " }, "digitallyConfirmedBy", /who confirmed/],
  ])("rejects %j", (overrides, field, message) => {
    const { errors } = check(overrides as Partial<EigenbelegInput>);
    expect(Object.keys(errors)).toEqual([field]);
    expect(errors[field as keyof typeof errors]).toMatch(message);
  });

  it("the first and last day of the period are allowed", () => {
    expect(check({ expenseDate: "2026-09-01" }).errors).toEqual({});
    expect(check({ expenseDate: "2026-09-30" }).errors).toEqual({});
  });

  it("warns (but allows) amounts over 250 EUR", () => {
    expect(check({ grossAmount: "250.00" }).warnings).toEqual([]);
    const r = check({ grossAmount: "250.01" });
    expect(r.errors).toEqual({});
    expect(r.warnings).toEqual([expect.stringMatching(/Over 250 EUR/)]);
  });

  it("'other' reason with an explanation is fine; digital confirmation with a name is fine", () => {
    expect(check({ reason: "OTHER", reasonDetail: "Beleg im Fahrzeugbrand vernichtet", digitallyConfirmedBy: "Klaus Weber" }).errors).toEqual({});
  });
});

describe("germanMoney", () => {
  it.each([
    ["47.60", "47,60 EUR"],
    ["1234.5", "1.234,50 EUR"],
    ["1234567.89", "1.234.567,89 EUR"],
    ["0.07", "0,07 EUR"],
    ["-12.00", "-12,00 EUR"],
  ])("%s → %s", (input, expected) => expect(germanMoney(input)).toBe(expected));
});

describe("buildVoucher / voucherText", () => {
  it("records every statutory field, with 0,00 EUR input VAT and the §15 UStG note", () => {
    const v = buildVoucher(VALID, "EB-10003-0001");
    expect(v.number).toBe("EB-10003-0001");
    expect(Object.fromEntries(v.fields)).toEqual({
      Mandant: "Weber Bau GmbH (Nr. 10003)",
      "Datum der Ausgabe": "03.09.2026",
      Zahlungsempfänger: "Telefónica Germany GmbH & Co. OHG",
      "Gegenstand / Leistung": "O2 Business Mobilfunk, September 2026",
      "Betrag (brutto, bezahlt)": "47,60 EUR",
      "Davon Vorsteuer": "0,00 EUR",
      "Als Betriebsausgabe zu buchen": "47,60 EUR",
      "Grund für fehlenden Originalbeleg": MISSING_REASONS.LOST,
      "Betrieblicher Anlass": "Diensthandy des Bauleiters für Baustellenkommunikation",
      Zuordnung: "Eingangsrechnungen September 2026",
    });
    expect(v.vatNote).toMatch(/§ 15 Abs\. 1 Nr\. 1 UStG/);
    expect(v.signature).toEqual({ mode: "WET" });
    expect(v.footer).toBe("Erstellt am 04.10.2026 von staff:demo. Unveränderbar gespeichert (SHA-256), GoBD-konform archiviert.");
  });

  it("appends an optional detail to a standard reason; 'other' uses the detail alone", () => {
    const detailed = buildVoucher({ ...VALID, reason: "ILLEGIBLE", reasonDetail: "Thermopapier verblasst" }, "EB-1");
    expect(Object.fromEntries(detailed.fields)["Grund für fehlenden Originalbeleg"]).toBe("Originalbeleg unleserlich – Thermopapier verblasst");
    const other = buildVoucher({ ...VALID, reason: "OTHER", reasonDetail: "  Fahrzeugbrand  " }, "EB-1");
    expect(Object.fromEntries(other.fields)["Grund für fehlenden Originalbeleg"]).toBe("Fahrzeugbrand");
  });

  it("text has a signature line, or the digital confirmation instead", () => {
    expect(voucherText(buildVoucher(VALID, "EB-10003-0001"))).toMatch(/^Eigenbeleg \(Ersatzbeleg\)  Nr\. EB-10003-0001\n[\s\S]*Unterschrift des Zahlenden: _+/);
    const digital = voucherText(buildVoucher({ ...VALID, digitallyConfirmedBy: " Klaus Weber " }, "EB-2"));
    expect(digital).toContain("Digital bestätigt durch: Klaus Weber");
    expect(digital).not.toContain("Unterschrift");
  });
});
