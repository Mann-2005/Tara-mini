import { describe, expect, it } from "vitest";
import { dueText, gapAction, longDate, periodLabel, shortDate } from "./format";

describe("dates", () => {
  it("formats short and long dates without time-zone drift", () => {
    expect(shortDate("2026-10-12")).toBe("Mon 12 Oct");
    expect(longDate("2026-10-02")).toBe("Friday, 2 October 2026");
  });
});

describe("periodLabel", () => {
  it("names whole months and calendar quarters", () => {
    expect(periodLabel("2026-09-01", "2026-09-30")).toBe("September 2026");
    expect(periodLabel("2026-07-01", "2026-09-30")).toBe("Q3 2026");
    expect(periodLabel("2025-07-01", "2026-06-30")).toBe("Tue 1 Jul 2025 to Tue 30 Jun 2026");
  });
});

describe("dueText", () => {
  it.each([
    [-46, "46 days overdue"],
    [-1, "1 day overdue"],
    [0, "due today"],
    [1, "due tomorrow"],
    [3, "due in 3 days"],
  ])("%i → %s", (days, text) => expect(dueText(days)).toBe(text));
});

describe("gapAction", () => {
  const base = { typeName: "Kontoauszüge", confirmedDocumentCount: 0, minDocuments: 1 };
  it("firm filings read as a task for the firm", () => {
    expect(gapAction({ ...base, typeName: "Umsatzsteuervoranmeldung", kind: "FIRM_FILING", receipt: "MISSING" }).title).toBe(
      "File Umsatzsteuervoranmeldung",
    );
  });
  it("client deliveries describe what has arrived", () => {
    expect(gapAction({ ...base, kind: "CLIENT_DELIVERY", receipt: "MISSING" }).detail).toBe("Nothing received");
    expect(gapAction({ ...base, kind: "CLIENT_DELIVERY", receipt: "PARTIAL", confirmedDocumentCount: 1, minDocuments: 3 }).detail).toBe(
      "1 of 3 received",
    );
    expect(
      gapAction({ ...base, typeName: "Eingangsrechnungen", kind: "CLIENT_DELIVERY", receipt: "AWAITING_CLOSE", confirmedDocumentCount: 2 }),
    ).toEqual({ title: "Close Eingangsrechnungen", detail: "2 documents received, check they are complete" });
  });
});
