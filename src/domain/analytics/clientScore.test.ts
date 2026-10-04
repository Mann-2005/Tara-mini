import { describe, expect, it } from "vitest";
import { addDays } from "../calendar/isoDate";
import { computeClientScore, gradeForAverageDelay, type ScoreObligation } from "./clientScore";

const AS_OF = "2026-10-02";
const CLIENT = { id: "c1" };

let n = 0;
/** A client delivery due on `due`, delivered `delay` days late (null = not delivered). */
function ob(due: string, delay: number | null, overrides: Partial<ScoreObligation> = {}): ScoreObligation {
  n++;
  return {
    id: `o${String(n).padStart(3, "0")}`,
    kind: "CLIENT_DELIVERY",
    status: delay === null ? "OPEN" : "COMPLETE",
    dueDate: due,
    minDocuments: 1,
    completedAt: null,
    deliveryDates: delay === null ? [] : [addDays(due, delay)],
    ...overrides,
  };
}

const score = (obs: ScoreObligation[], asOf = AS_OF, options = {}) => computeClientScore(CLIENT, obs, asOf, options);

describe("gradeForAverageDelay — the scale", () => {
  it.each([
    [0, "A", 100],
    [0.5, "A", 95],
    [1, "A", 90], // boundary: ≤ 1 day is still A
    [1.01, "B", 89],
    [3, "B", 82],
    [5, "B", 75], // boundary
    [5.01, "C", 74],
    [9.5, "C", 62],
    [14, "C", 50], // boundary
    [14.01, "D", 49],
    [29, "D", 25],
    [44, "D", 0],
    [120, "D", 0], // floor
  ])("%f days → %s %i", (avg, grade, points) => {
    expect(gradeForAverageDelay(avg)).toEqual({ grade, points });
  });

  it("points always stay inside the grade's band", () => {
    for (let avg = 0; avg <= 60; avg += 0.05) {
      const { grade, points } = gradeForAverageDelay(avg);
      const range = { A: [90, 100], B: [75, 89], C: [50, 74], D: [0, 49] }[grade];
      expect(points).toBeGreaterThanOrEqual(range[0]);
      expect(points).toBeLessThanOrEqual(range[1]);
    }
  });

  it.each([-1, Number.NaN])("rejects %f", (avg) => {
    expect(() => gradeForAverageDelay(avg)).toThrow(/≥ 0/);
  });
});

describe("computeClientScore — grades from real histories", () => {
  it("always on time → Grade A 100", () => {
    const r = score([ob("2026-07-15", 0), ob("2026-08-05", 0), ob("2026-09-07", -3)]); // early counts as 0
    expect(r).toMatchObject({ grade: "A", points: 100, averageDelayDays: 0, measured: 3, onTime: 3, stillOpenOverdue: 0, worst: [], reason: "SCORED" });
  });

  it("a few days late on average → Grade B", () => {
    expect(score([ob("2026-07-15", 2), ob("2026-08-05", 3), ob("2026-09-07", 4)])).toMatchObject({ grade: "B", averageDelayDays: 3, points: 82 });
  });

  it("one to two weeks late → Grade C", () => {
    expect(score([ob("2026-07-15", 7), ob("2026-08-05", 10), ob("2026-09-07", 12)]).grade).toBe("C");
  });

  it("chronic backlog → Grade D, and the worst offenders are listed", () => {
    // Weber-like: Aug and Sep payroll still missing at 2 Oct.
    const r = score([ob("2026-07-15", 0), ob("2026-08-17", null), ob("2026-09-15", null)]);
    expect(r).toMatchObject({ grade: "D", measured: 3, onTime: 1, stillOpenOverdue: 2 });
    expect(r.averageDelayDays).toBeCloseTo((0 + 46 + 17) / 3);
    expect(r.worst.map((w) => [w.dueDate, w.delayDays, w.deliveredOn])).toEqual([
      ["2026-08-17", 46, null],
      ["2026-09-15", 17, null],
    ]);
  });

  it("lists at most three worst offenders, ties broken by due date then id", () => {
    const r = score([ob("2026-07-01", 5), ob("2026-06-01", 5), ob("2026-08-01", 9), ob("2026-09-01", 1), ob("2026-05-01", 5)]);
    expect(r.worst.map((w) => w.dueDate)).toEqual(["2026-08-01", "2026-05-01", "2026-06-01"]);
  });

  it("worst offenders with the same due date and delay are ordered by id", () => {
    const a = ob("2026-07-01", 5, { id: "b-second" });
    const b = ob("2026-07-01", 5, { id: "a-first" });
    expect(score([a, b, ob("2026-08-01", 0)]).worst.map((w) => w.obligationId)).toEqual(["a-first", "b-second"]);
  });
});

describe("computeClientScore — what is measured", () => {
  it("firm filings (UStVA) never count against the client", () => {
    const late = ob("2026-08-10", 30, { kind: "FIRM_FILING" });
    const r = score([late, ob("2026-07-15", 0), ob("2026-08-05", 0), ob("2026-09-07", 0)]);
    expect(r).toMatchObject({ grade: "A", measured: 3 });
  });

  it("waived obligations are excluded", () => {
    expect(score([ob("2026-08-01", null, { status: "WAIVED" }), ob("2026-07-15", 0), ob("2026-08-05", 0), ob("2026-09-07", 0)]).measured).toBe(3);
  });

  it("obligations not yet due are excluded", () => {
    expect(score([ob("2026-10-05", null), ob("2026-07-15", 0), ob("2026-08-05", 0), ob("2026-09-07", 0)]).measured).toBe(3);
  });

  it("due today and not yet delivered is not late (deadline runs to end of day)", () => {
    const r = score([ob(AS_OF, null), ob("2026-08-05", 0), ob("2026-09-07", 0)]);
    expect(r).toMatchObject({ measured: 3, averageDelayDays: 0, stillOpenOverdue: 0, onTime: 2 });
  });

  it("window: due exactly 6 months ago is outside, one day later is inside", () => {
    const outside = ob("2026-04-02", 40);
    const inside = ob("2026-04-03", 0);
    const r = score([outside, inside, ob("2026-08-05", 0), ob("2026-09-07", 0)]);
    expect(r).toMatchObject({ measured: 3, grade: "A", window: { from: "2026-04-02", to: AS_OF } });
  });

  it("the window clamps to the month's length (31 Aug minus 6 months = 28 Feb)", () => {
    expect(score([], "2026-08-31").window.from).toBe("2026-02-28");
  });

  it("windowMonths is configurable", () => {
    expect(score([ob("2026-02-10", 40), ob("2026-08-05", 0), ob("2026-09-07", 0)], AS_OF, { windowMonths: 12 }).measured).toBe(3);
  });
});

describe("computeClientScore — the client's delivery date", () => {
  it("uses the upload date, not the (later) date staff closed the period", () => {
    const delivered = ob("2026-08-05", null, { status: "COMPLETE", deliveryDates: ["2026-08-04"], completedAt: "2026-08-20" });
    const r = score([delivered, ob("2026-07-15", 0), ob("2026-09-07", 0)]);
    expect(r).toMatchObject({ grade: "A", averageDelayDays: 0 });
  });

  it("with minDocuments = 2, delivery is the second upload", () => {
    const two = ob("2026-08-05", null, { status: "COMPLETE", minDocuments: 2, deliveryDates: ["2026-08-15", "2026-08-01"] });
    const r = score([two, ob("2026-07-15", 0), ob("2026-09-07", 0)]);
    expect(r.averageDelayDays).toBeCloseTo(10 / 3); // 2nd upload on 15 Aug = 10 days late
  });

  it("uploads after the as-of date do not count yet (time travel)", () => {
    const future = ob("2026-09-15", null, { deliveryDates: ["2026-10-10"] });
    const r = score([future, ob("2026-07-15", 0), ob("2026-08-05", 0)]);
    expect(r).toMatchObject({ stillOpenOverdue: 1 });
    expect(r.worst[0]).toMatchObject({ deliveredOn: null, delayDays: 17 });
  });

  it("completed without enough documents → falls back to the completion date", () => {
    const manual = ob("2026-08-05", null, { status: "COMPLETE", completedAt: "2026-08-09" });
    const r = score([manual, ob("2026-07-15", 0), ob("2026-09-07", 0)]);
    expect(r.worst[0]).toMatchObject({ deliveredOn: "2026-08-09", delayDays: 4 });
  });

  it("a completion date after the as-of date is ignored (still outstanding then)", () => {
    const later = ob("2026-09-15", null, { status: "COMPLETE", completedAt: "2026-10-20" });
    expect(score([later, ob("2026-07-15", 0), ob("2026-08-05", 0)]).worst[0]).toMatchObject({ deliveredOn: null, delayDays: 17 });
  });

  it("an open obligation with too few documents keeps accruing delay", () => {
    const partial = ob("2026-09-07", null, { minDocuments: 2, deliveryDates: ["2026-09-01"] });
    expect(score([partial, ob("2026-07-15", 0), ob("2026-08-05", 0)]).worst[0]).toMatchObject({ deliveredOn: null, delayDays: 25 });
  });
});

describe("computeClientScore — thin history and contract", () => {
  it("fewer than 3 measured obligations → no grade", () => {
    expect(score([ob("2026-08-05", 30), ob("2026-09-07", 30)])).toMatchObject({
      grade: null,
      points: null,
      averageDelayDays: null,
      reason: "INSUFFICIENT_HISTORY",
      measured: 2,
    });
  });

  it("no obligations at all → no grade", () => {
    expect(score([])).toMatchObject({ grade: null, measured: 0, worst: [] });
  });

  it("minObligations is configurable", () => {
    expect(score([ob("2026-09-07", 0)], AS_OF, { minObligations: 1 }).grade).toBe("A");
  });

  it("is independent of input order", () => {
    const obs = [ob("2026-07-15", 0), ob("2026-08-17", null), ob("2026-09-15", 3), ob("2026-06-05", 8)];
    expect(score([...obs].reverse())).toEqual(score(obs));
  });

  it("does not mutate its input", () => {
    const obs = [ob("2026-08-05", null, { status: "COMPLETE", minDocuments: 2, deliveryDates: ["2026-08-15", "2026-08-01"] })];
    const copy = structuredClone(obs);
    score(obs);
    expect(obs).toEqual(copy);
  });

  it.each([
    [{ windowMonths: 0 }, /windowMonths/],
    [{ windowMonths: 1.5 }, /windowMonths/],
    [{ minObligations: 0 }, /minObligations/],
    [{ minObligations: 2.5 }, /minObligations/],
  ])("rejects invalid options %j", (options, message) => {
    expect(() => score([], AS_OF, options)).toThrow(message);
  });
});
