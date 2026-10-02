import { describe, expect, it } from "vitest";
import { proposalToClassificationData, toMoney } from "./proposalToDb";

describe("proposalToClassificationData", () => {
  it("stores money as exact 2-decimal strings and dates as UTC-midnight", () => {
    const data = proposalToClassificationData({
      documentType: "INCOMING_INVOICE",
      documentDate: "2026-09-10",
      amount: 8925,
      vatAmount: 1425.5,
      currency: "EUR",
      counterparty: "Krämer",
      confidence: 0.9,
    });
    expect(data).toMatchObject({ amount: "8925.00", vatAmount: "1425.50", currency: "EUR", counterparty: "Krämer" });
    expect(data.documentDate?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("keeps nulls as nulls", () => {
    expect(toMoney(null)).toBeNull();
    expect(toMoney(0)).toBe("0.00");
    expect(toMoney(-12.5)).toBe("-12.50"); // credit notes
  });
});
