import { describe, expect, it } from "vitest";
import { compareText } from "./compare";

describe("compareText", () => {
  it("orders by code unit, locale-independent", () => {
    expect(compareText("a", "b")).toBe(-1);
    expect(compareText("b", "a")).toBe(1);
    expect(compareText("a", "a")).toBe(0);
    expect(compareText("Z", "a")).toBe(-1); // upper case before lower case, unlike localeCompare
    expect(["2026-09-01", "2026-07-15", "2026-08-05"].sort(compareText)).toEqual(["2026-07-15", "2026-08-05", "2026-09-01"]);
  });
});
