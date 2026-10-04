import { describe, expect, it } from "vitest";
import { centsToDecimal, parseMoney, toCents } from "./money";

describe("parseMoney", () => {
  it.each([
    ["8.925,00", "8925.00"],
    ["8925.00", "8925.00"],
    ["91,54 €", "91.54"],
    ["12 EUR", "12.00"],
    ["", null],
    ["   ", null],
  ])("%s → %s", (input, expected) => expect(parseMoney(input)).toBe(expected));

  it("rejects invalid input", () => {
    expect(parseMoney("1,2,3")).toBeUndefined();
    expect(parseMoney("12.345")).toBeUndefined();
  });
});

describe("toCents", () => {
  it.each([
    ["0.00", 0],
    ["8925.00", 892500],
    ["8925", 892500],
    ["91.5", 9150],
    ["0.07", 7],
    ["-12.50", -1250],
    [" 14.62 ", 1462],
    ["123456789.99", 12345678999],
  ])("%s → %i", (input, cents) => expect(toCents(input)).toBe(cents));

  it("is exact where floating point is not (0.1 + 0.2)", () => {
    expect(toCents("0.10") + toCents("0.20")).toBe(toCents("0.30"));
  });

  it.each(["", "abc", "1.234", "1,50", "--1", "1.", ".5"])("rejects %j", (bad) => {
    expect(() => toCents(bad)).toThrow(/Not a decimal money amount/);
  });
});

describe("centsToDecimal", () => {
  it.each([
    [0, "0.00"],
    [7, "0.07"],
    [892500, "8925.00"],
    [-1250, "-12.50"],
    [-5, "-0.05"],
  ])("%i → %s", (cents, s) => expect(centsToDecimal(cents)).toBe(s));

  it("round-trips with toCents", () => {
    for (const s of ["0.00", "0.01", "99.99", "-1462.30", "8925.00"]) expect(centsToDecimal(toCents(s))).toBe(s);
  });

  it("rejects non-integers", () => {
    expect(() => centsToDecimal(1.5)).toThrow(/integer/);
  });
});
