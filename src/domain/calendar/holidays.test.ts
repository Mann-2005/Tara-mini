import { describe, expect, it } from "vitest";
import { easterSunday, holidayOn, publicHolidays } from "./holidays";

describe("easterSunday", () => {
  it.each([
    [2000, "2000-04-23"],
    [2008, "2008-03-23"], // early Easter
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2038, "2038-04-25"], // latest possible date
  ])("%i → %s", (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });
});

describe("publicHolidays — nationwide", () => {
  it("has the 9 national holidays in every state (2026)", () => {
    const nw = publicHolidays(2026, "NW").map((h) => h.name);
    for (const name of [
      "Neujahr",
      "Karfreitag",
      "Ostermontag",
      "Tag der Arbeit",
      "Christi Himmelfahrt",
      "Pfingstmontag",
      "Tag der Deutschen Einheit",
      "1. Weihnachtstag",
      "2. Weihnachtstag",
    ]) {
      expect(nw).toContain(name);
    }
  });

  it("derives the Easter-based dates for 2026", () => {
    expect(holidayOn("2026-04-03", "HH")?.name).toBe("Karfreitag");
    expect(holidayOn("2026-04-06", "HH")?.name).toBe("Ostermontag");
    expect(holidayOn("2026-05-14", "HH")?.name).toBe("Christi Himmelfahrt");
    expect(holidayOn("2026-05-25", "HH")?.name).toBe("Pfingstmontag");
  });

  it("returns holidays sorted by date", () => {
    const dates = publicHolidays(2026, "BY").map((h) => h.date);
    expect(dates).toEqual([...dates].sort());
  });
});

describe("publicHolidays — state-specific", () => {
  it("Mariä Himmelfahrt (15 Aug) only in Bayern and Saarland", () => {
    expect(holidayOn("2025-08-15", "BY")?.name).toBe("Mariä Himmelfahrt");
    expect(holidayOn("2025-08-15", "SL")?.name).toBe("Mariä Himmelfahrt");
    expect(holidayOn("2025-08-15", "NW")).toBeUndefined();
    expect(holidayOn("2025-08-15", "HH")).toBeUndefined();
    expect(holidayOn("2025-08-15", "BW")).toBeUndefined();
  });

  it("Fronleichnam (Easter + 60) in BW, BY, HE, NW, RP, SL — not in HH, BE, SN", () => {
    for (const s of ["BW", "BY", "HE", "NW", "RP", "SL"] as const) expect(holidayOn("2026-06-04", s)?.name).toBe("Fronleichnam");
    for (const s of ["HH", "BE", "SN"] as const) expect(holidayOn("2026-06-04", s)).toBeUndefined();
  });

  it("Reformationstag (31 Oct) in the northern/eastern states since 2018", () => {
    expect(holidayOn("2025-10-31", "HH")?.name).toBe("Reformationstag");
    expect(holidayOn("2025-10-31", "SN")?.name).toBe("Reformationstag");
    expect(holidayOn("2025-10-31", "BY")).toBeUndefined();
    expect(holidayOn("2025-10-31", "NW")).toBeUndefined();
    expect(holidayOn("2017-10-31", "HH")).toBeUndefined(); // before HH adopted it (the 2017 one-off is not modelled)
  });

  it("Allerheiligen (1 Nov) in BW, BY, NW, RP, SL", () => {
    expect(holidayOn("2027-11-01", "NW")?.name).toBe("Allerheiligen");
    expect(holidayOn("2027-11-01", "HH")).toBeUndefined();
  });

  it("Heilige Drei Könige (6 Jan) in BW, BY, ST", () => {
    expect(holidayOn("2027-01-06", "ST")?.name).toBe("Heilige Drei Könige");
    expect(holidayOn("2027-01-06", "NW")).toBeUndefined();
  });

  it("Buß- und Bettag: Wednesday before 23 Nov, Sachsen only", () => {
    expect(holidayOn("2026-11-18", "SN")?.name).toBe("Buß- und Bettag");
    expect(holidayOn("2027-11-17", "SN")?.name).toBe("Buß- und Bettag");
    expect(holidayOn("2026-11-18", "BY")).toBeUndefined();
  });

  it("Internationaler Frauentag: Berlin since 2019, Mecklenburg-Vorpommern since 2023", () => {
    expect(holidayOn("2026-03-08", "BE")?.name).toBe("Internationaler Frauentag");
    expect(holidayOn("2026-03-08", "MV")?.name).toBe("Internationaler Frauentag");
    expect(holidayOn("2022-03-08", "MV")).toBeUndefined();
    expect(holidayOn("2018-03-08", "BE")).toBeUndefined();
  });

  it("Weltkindertag (20 Sep) in Thüringen only", () => {
    expect(holidayOn("2026-09-20", "TH")?.name).toBe("Weltkindertag");
    expect(holidayOn("2026-09-20", "SN")).toBeUndefined();
  });
});
