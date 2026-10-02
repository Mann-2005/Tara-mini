import { describe, expect, it } from "vitest";
import { BECKER, FISCHER, MUELLER, RULES, SCHMIDT, WEBER, client } from "../testFixtures";
import { generateObligations, lastFullMonths } from "./generate";

const codes = (specs: { obligationTypeCode: string }[]) => [...new Set(specs.map((s) => s.obligationTypeCode))].sort();
const summary = (specs: ReturnType<typeof generateObligations>) =>
  specs.map((s) => `${s.obligationTypeCode} ${s.periodStart}..${s.periodEnd} due ${s.dueDate}`);

describe("lastFullMonths", () => {
  it("2 Oct 2026, 3 months → Jul–Sep 2026", () => {
    expect(lastFullMonths("2026-10-02", 3)).toEqual(["2026-07", "2026-09"]);
  });
  it("crosses the year boundary", () => {
    expect(lastFullMonths("2027-02-15", 3)).toEqual(["2026-11", "2027-01"]);
  });
});

describe("generateObligations — which types apply", () => {
  it("monthly VAT + payroll client gets all four types every month", () => {
    const specs = generateObligations(MUELLER, RULES, "2026-07", "2026-09");
    expect(codes(specs)).toEqual(["EINGANGSRECHNUNGEN", "KONTOAUSZUEGE", "LOHN", "USTVA"]);
    expect(specs).toHaveLength(12);
  });

  it("client WITHOUT payroll gets no Lohn obligations", () => {
    const specs = generateObligations(SCHMIDT, RULES, "2026-07", "2026-09");
    expect(codes(specs)).not.toContain("LOHN");
    expect(specs.filter((s) => s.obligationTypeCode === "LOHN")).toEqual([]);
  });

  it("VAT-exempt client (frequency NONE) gets no UStVA, but still owes Belege and Lohn", () => {
    const specs = generateObligations(FISCHER, RULES, "2026-07", "2026-09");
    expect(codes(specs)).toEqual(["EINGANGSRECHNUNGEN", "KONTOAUSZUEGE", "LOHN"]);
  });
});

describe("generateObligations — periods", () => {
  it("quarterly filer: exactly one UStVA for Q3 (1 Jul – 30 Sep), monthly Belege", () => {
    const specs = generateObligations(SCHMIDT, RULES, "2026-07", "2026-09");
    const ustva = specs.filter((s) => s.obligationTypeCode === "USTVA");
    expect(ustva).toEqual([
      expect.objectContaining({ periodStart: "2026-07-01", periodEnd: "2026-09-30", dueDate: "2026-10-12" }),
    ]);
    expect(specs.filter((s) => s.obligationTypeCode === "KONTOAUSZUEGE")).toHaveLength(3);
  });

  it("quarterly filer: a window that does not contain a quarter end yields no UStVA", () => {
    const specs = generateObligations(SCHMIDT, RULES, "2026-07", "2026-08");
    expect(specs.filter((s) => s.obligationTypeCode === "USTVA")).toEqual([]);
  });

  it("quarterly filer with a non-calendar fiscal year still follows calendar quarters (⚠ §18 UStG)", () => {
    const specs = generateObligations(BECKER, RULES, "2026-07", "2026-09");
    expect(specs.find((s) => s.obligationTypeCode === "USTVA")).toMatchObject({
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      dueDate: "2026-11-10", // Dauerfrist
    });
  });

  it("annual recurrence ends in the client's fiscal-year-end month", () => {
    const annual = { ...RULES[0], id: "JA", code: "JA", appliesWhen: "ALWAYS" as const, recurrence: "ANNUAL" as const };
    const specs = generateObligations(BECKER, [annual], "2026-01", "2026-12");
    expect(specs.map((s) => [s.periodStart, s.periodEnd])).toEqual([["2025-07-01", "2026-06-30"]]);
  });

  it("produces the seed's due dates for Weber (Dauerfrist, NRW)", () => {
    expect(summary(generateObligations(WEBER, RULES, "2026-07", "2026-09"))).toEqual([
      "EINGANGSRECHNUNGEN 2026-07-01..2026-07-31 due 2026-09-07",
      "KONTOAUSZUEGE 2026-07-01..2026-07-31 due 2026-09-07",
      "LOHN 2026-07-01..2026-07-31 due 2026-07-15",
      "USTVA 2026-07-01..2026-07-31 due 2026-09-10",
      "EINGANGSRECHNUNGEN 2026-08-01..2026-08-31 due 2026-10-05",
      "KONTOAUSZUEGE 2026-08-01..2026-08-31 due 2026-10-05",
      "LOHN 2026-08-01..2026-08-31 due 2026-08-17",
      "USTVA 2026-08-01..2026-08-31 due 2026-10-12",
      "EINGANGSRECHNUNGEN 2026-09-01..2026-09-30 due 2026-11-05",
      "KONTOAUSZUEGE 2026-09-01..2026-09-30 due 2026-11-05",
      "LOHN 2026-09-01..2026-09-30 due 2026-09-15",
      "USTVA 2026-09-01..2026-09-30 due 2026-11-10",
    ]);
  });

  it("handles a window across the year boundary", () => {
    const specs = generateObligations(client(), RULES, "2026-12", "2027-01");
    expect(specs.find((s) => s.obligationTypeCode === "USTVA" && s.periodStart === "2026-12-01")?.dueDate).toBe("2027-01-11");
  });
});

describe("generateObligations — determinism", () => {
  it("same inputs give identical output, independent of rule order", () => {
    const a = generateObligations(MUELLER, RULES, "2026-07", "2026-09");
    const b = generateObligations(MUELLER, [...RULES].reverse(), "2026-07", "2026-09");
    expect(b).toEqual(a);
  });
});
