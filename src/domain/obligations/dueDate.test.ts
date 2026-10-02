import { describe, expect, it } from "vitest";
import { client, rule } from "../testFixtures";
import { computeDueDate } from "./dueDate";

const USTVA = rule("USTVA");
const KONTO = rule("KONTOAUSZUEGE");
const LOHN = rule("LOHN");

describe("UStVA due date: 10th of the following month (§18 Abs. 1 UStG)", () => {
  const monthly = client({ federalState: "NW" });

  it("July → 10 August (a Monday, no shift)", () => {
    expect(computeDueDate(USTVA, monthly, "2026-07-31")).toBe("2026-08-10");
  });

  it("November → 10 December (Thursday)", () => {
    expect(computeDueDate(USTVA, monthly, "2026-11-30")).toBe("2026-12-10");
  });

  it("weekend: September 2026 → 10 Oct is a Saturday → Monday 12 Oct", () => {
    expect(computeDueDate(USTVA, monthly, "2026-09-30")).toBe("2026-10-12");
  });

  it("year rollover + weekend: December 2026 → 10 Jan 2027 is a Sunday → Monday 11 Jan", () => {
    expect(computeDueDate(USTVA, monthly, "2026-12-31")).toBe("2027-01-11");
  });

  it("quarterly: Q3 2026 (period ends 30 Sep) → also 12 Oct", () => {
    expect(computeDueDate(USTVA, client({ vatFilingFrequency: "QUARTERLY" }), "2026-09-30")).toBe("2026-10-12");
  });
});

describe("Dauerfristverlängerung (§§46–48 UStDV): one month later", () => {
  const withDF = client({ hasDauerfristverlaengerung: true });

  it("monthly July → 10 September instead of 10 August", () => {
    expect(computeDueDate(USTVA, withDF, "2026-07-31")).toBe("2026-09-10");
  });

  it("monthly August → 10 Oct is a Saturday → 12 Oct (extension AND weekend)", () => {
    expect(computeDueDate(USTVA, withDF, "2026-08-31")).toBe("2026-10-12");
  });

  it("quarterly Q3 → 10 November", () => {
    expect(computeDueDate(USTVA, client({ vatFilingFrequency: "QUARTERLY", hasDauerfristverlaengerung: true }), "2026-09-30")).toBe("2026-11-10");
  });

  it("quarterly Q4 2026 → 10 February 2027 (year rollover)", () => {
    expect(computeDueDate(USTVA, client({ vatFilingFrequency: "QUARTERLY", hasDauerfristverlaengerung: true }), "2026-12-31")).toBe("2027-02-10");
  });

  it("⚠ also shifts the client document deadline (firm rule): July bank statements → 7 Sep (5 Sep is a Saturday)", () => {
    expect(computeDueDate(KONTO, client({ hasDauerfristverlaengerung: false }), "2026-07-31")).toBe("2026-08-05");
    expect(computeDueDate(KONTO, withDF, "2026-07-31")).toBe("2026-09-07");
  });

  it("does NOT shift payroll data (Lohn is not a VAT deadline)", () => {
    expect(computeDueDate(LOHN, withDF, "2026-07-31")).toBe(computeDueDate(LOHN, client(), "2026-07-31"));
    expect(computeDueDate(LOHN, withDF, "2026-07-31")).toBe("2026-07-15");
  });
});

describe("state-specific holidays move the deadline only in that state", () => {
  // ⚠ Lohndaten due the 15th of the same month. 15 Aug 2025 is a Friday.
  it("Mariä Himmelfahrt 2025: Bayern → Monday 18 Aug, NRW → Friday 15 Aug", () => {
    expect(computeDueDate(LOHN, client({ federalState: "BY" }), "2025-08-31")).toBe("2025-08-18");
    expect(computeDueDate(LOHN, client({ federalState: "NW" }), "2025-08-31")).toBe("2025-08-15");
  });

  it("Mariä Himmelfahrt 2024 (Thursday): Bayern → Friday 16 Aug", () => {
    expect(computeDueDate(LOHN, client({ federalState: "BY" }), "2024-08-31")).toBe("2024-08-16");
  });

  it("Mariä Himmelfahrt 2026 is a Saturday anyway: Bayern and NRW both → Monday 17 Aug", () => {
    expect(computeDueDate(LOHN, client({ federalState: "BY" }), "2026-08-31")).toBe("2026-08-17");
    expect(computeDueDate(LOHN, client({ federalState: "NW" }), "2026-08-31")).toBe("2026-08-17");
  });
});

describe("rule mechanics", () => {
  const noRoll = { dueMonthsAfterPeriodEnd: 1, dueDayOfMonth: 31, dauerfristExtensionMonths: 0, rollForwardToWorkingDay: false };

  it("clamps day 31 to the end of a short month", () => {
    expect(computeDueDate(noRoll, client(), "2027-01-31")).toBe("2027-02-28");
    expect(computeDueDate(noRoll, client(), "2028-01-31")).toBe("2028-02-29"); // leap year
  });

  it("without roll-forward a weekend due date stays on the weekend", () => {
    expect(computeDueDate({ ...USTVA, rollForwardToWorkingDay: false }, client(), "2026-09-30")).toBe("2026-10-10");
  });
});
