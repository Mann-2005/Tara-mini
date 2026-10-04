import { describe, expect, it } from "vitest";
import { vendorKey } from "./vendorKey";

describe("vendorKey", () => {
  it.each([
    ["Telefónica Germany GmbH & Co. OHG", "telefonica germany"],
    ["Telefonica Germany", "telefonica germany"],
    ["Baustoffhandel Krämer GmbH", "baustoffhandel kraemer"],
    ["Baustoffhandel Kraemer", "baustoffhandel kraemer"],
    ["Becker Online-Handel UG (haftungsbeschränkt)", "becker online handel"],
    ["Hetzner Online GmbH", "hetzner online"],
    ["Müller e.K.", "mueller"],
    ["Straßenbau SE", "strassenbau"],
    ["  ACME   Ltd. ", "acme"],
    ["1&1 Telecom GmbH", "1 1 telecom"],
  ])("%j → %j", (input, key) => expect(vendorKey(input)).toBe(key));

  it("spelling variants of the same vendor share a key", () => {
    expect(vendorKey("Stadtwerke München GmbH")).toBe(vendorKey("STADTWERKE MUENCHEN"));
  });

  it("returns an empty key when only legal forms or punctuation remain", () => {
    expect(vendorKey("GmbH & Co. KG")).toBe("");
    expect(vendorKey("")).toBe("");
    expect(vendorKey(" — ")).toBe("");
  });

  it("does not merge genuinely different vendors", () => {
    expect(vendorKey("O2")).not.toBe(vendorKey("Telefónica Germany")); // known limitation: no alias table
    expect(vendorKey("Telekom")).not.toBe(vendorKey("Telefonica"));
  });
});
