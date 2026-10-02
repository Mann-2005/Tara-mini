import { describe, expect, it } from "vitest";
import { isWorkingDay, nextWorkingDay } from "./workingDays";

describe("isWorkingDay", () => {
  it("weekdays are working days, weekends are not", () => {
    expect(isWorkingDay("2026-10-09", "NW")).toBe(true); // Friday
    expect(isWorkingDay("2026-10-10", "NW")).toBe(false); // Saturday
    expect(isWorkingDay("2026-10-11", "NW")).toBe(false); // Sunday
  });

  it("a weekday public holiday is not a working day — but only in states that observe it", () => {
    expect(isWorkingDay("2025-08-15", "BY")).toBe(false); // Mariä Himmelfahrt, Friday
    expect(isWorkingDay("2025-08-15", "NW")).toBe(true);
  });
});

describe("nextWorkingDay (§108 Abs. 3 AO)", () => {
  it("leaves a working day unchanged", () => {
    expect(nextWorkingDay("2026-10-12", "NW")).toBe("2026-10-12");
  });

  it("Saturday → Monday", () => {
    expect(nextWorkingDay("2026-10-10", "NW")).toBe("2026-10-12");
  });

  it("Sunday → Monday", () => {
    expect(nextWorkingDay("2027-01-10", "NW")).toBe("2027-01-11");
  });

  it("Friday holiday + weekend + Monday holiday → Tuesday (Easter 2026)", () => {
    expect(nextWorkingDay("2026-04-03", "HH")).toBe("2026-04-07");
  });

  it("Mariä Himmelfahrt 2025 (Friday): Bayern → Monday, NRW → same day", () => {
    expect(nextWorkingDay("2025-08-15", "BY")).toBe("2025-08-18");
    expect(nextWorkingDay("2025-08-15", "SL")).toBe("2025-08-18");
    expect(nextWorkingDay("2025-08-15", "NW")).toBe("2025-08-15");
  });

  it("Fronleichnam 2026 (Thursday): NRW → Friday, Hamburg → same day", () => {
    expect(nextWorkingDay("2026-06-04", "NW")).toBe("2026-06-05");
    expect(nextWorkingDay("2026-06-04", "HH")).toBe("2026-06-04");
  });

  it("Tag der Deutschen Einheit on a weekday rolls forward everywhere", () => {
    expect(nextWorkingDay("2025-10-03", "HH")).toBe("2025-10-06"); // Fri → Mon
  });
});
