import { describe, expect, it } from "vitest";
import { generateObligations } from "../obligations/generate";
import type { ClientProfile, ObligationStatus } from "../obligations/types";
import { FISCHER, MUELLER, RULES, SCHMIDT, WEBER, standardType } from "../testFixtures";
import { computeGaps, type GapClient, type GapInput, type GapObligation } from "./gapEngine";

// ─── Helpers ────────────────────────────────────────────────────────────────

const C1: GapClient = { id: "c1", clientNumber: "10001", name: "Client One" };

let seq = 0;
function ob(overrides: Partial<GapObligation> = {}): GapObligation {
  return {
    id: `o${++seq}`,
    clientId: "c1",
    typeCode: "KONTOAUSZUEGE",
    typeName: "Kontoauszüge",
    kind: "CLIENT_DELIVERY",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    dueDate: "2026-10-05",
    status: "OPEN",
    minDocuments: 1,
    requiresManualCompletion: false,
    confirmedDocumentCount: 0,
    ...overrides,
  };
}

function single(asOf: string, o: GapObligation, dueSoonDays?: number) {
  const report = computeGaps({ asOf, clients: [C1], obligations: [o], dueSoonDays });
  return report.clients[0];
}

/**
 * End-to-end fixture: generate obligations with the REAL rules for a client
 * profile, then mark some as done. `done` keys look like "LOHN 2026-07".
 */
function fromProfile(
  profile: ClientProfile,
  clientNumber: string,
  state: { done?: string[]; docs?: Record<string, number> } = {},
): { client: GapClient; obligations: GapObligation[] } {
  const specs = generateObligations(profile, RULES, "2026-07", "2026-09");
  const obligations = specs.map((s): GapObligation => {
    const key = `${s.obligationTypeCode} ${s.periodEnd.slice(0, 7)}`;
    const t = standardType(s.obligationTypeCode);
    const status: ObligationStatus = state.done?.includes(key) ? "COMPLETE" : "OPEN";
    return {
      id: `${profile.id}:${key}`,
      clientId: profile.id,
      typeCode: s.obligationTypeCode,
      typeName: t.name,
      kind: t.kind,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      dueDate: s.dueDate,
      status,
      minDocuments: t.minDocuments,
      requiresManualCompletion: t.requiresManualCompletion,
      confirmedDocumentCount: state.docs?.[key] ?? (status === "COMPLETE" ? 1 : 0),
    };
  });
  return { client: { id: profile.id, clientNumber, name: profile.id }, obligations };
}

// ─── Timing ─────────────────────────────────────────────────────────────────

describe("timing: overdue / due soon / upcoming", () => {
  const o = ob({ dueDate: "2026-10-05" });

  it("the day after the due date is OVERDUE (-1 days)", () => {
    const gap = single("2026-10-06", o).gaps[0];
    expect(gap).toMatchObject({ timing: "OVERDUE", daysUntilDue: -1, severity: "RED" });
  });

  it("ON the due date it is DUE_SOON, not overdue (deadline runs to end of day)", () => {
    expect(single("2026-10-05", o).gaps[0]).toMatchObject({ timing: "DUE_SOON", daysUntilDue: 0 });
  });

  it("exactly 7 days before is DUE_SOON; 8 days before is UPCOMING", () => {
    expect(single("2026-09-28", o).gaps[0]).toMatchObject({ timing: "DUE_SOON", daysUntilDue: 7, severity: "AMBER" });
    expect(single("2026-09-27", o).gaps[0]).toMatchObject({ timing: "UPCOMING", daysUntilDue: 8, severity: "GREEN" });
  });

  it("the due-soon horizon is configurable", () => {
    expect(single("2026-09-27", o, 14).gaps[0].timing).toBe("DUE_SOON");
    expect(single("2026-09-28", o, 3).gaps[0].timing).toBe("UPCOMING");
  });

  it("counts by timing", () => {
    const report = computeGaps({
      asOf: "2026-10-02",
      clients: [C1],
      obligations: [ob({ dueDate: "2026-09-01" }), ob({ dueDate: "2026-10-05" }), ob({ dueDate: "2026-12-01" }), ob({ status: "COMPLETE" })],
    });
    expect(report.clients[0].counts).toEqual({ overdue: 1, dueSoon: 1, upcoming: 1, closed: 1 });
  });
});

// ─── Weekend due dates (end to end through the real rules) ──────────────────

describe("weekend due dates", () => {
  // September UStVA: 10 Oct 2026 is a Saturday → due Monday 12 Oct.
  const { client, obligations } = fromProfile(MUELLER, "10001", {
    done: [
      ...["2026-07", "2026-08", "2026-09"].flatMap((m) => [`KONTOAUSZUEGE ${m}`, `EINGANGSRECHNUNGEN ${m}`, `LOHN ${m}`]),
      "USTVA 2026-07",
      "USTVA 2026-08",
    ],
  });
  const ustvaSep = (asOf: string) =>
    computeGaps({ asOf, clients: [client], obligations }).clients[0].gaps.find((g) => g.typeCode === "USTVA");

  it("the generated due date is Monday 12 Oct, not Saturday 10 Oct", () => {
    expect(ustvaSep("2026-10-02")?.dueDate).toBe("2026-10-12");
  });

  it("on Saturday 10 Oct and Sunday 11 Oct it is NOT overdue", () => {
    expect(ustvaSep("2026-10-10")).toMatchObject({ timing: "DUE_SOON", daysUntilDue: 2 });
    expect(ustvaSep("2026-10-11")).toMatchObject({ timing: "DUE_SOON", daysUntilDue: 1 });
  });

  it("on Tuesday 13 Oct it is overdue — and it is the FIRM's filing → RED", () => {
    expect(ustvaSep("2026-10-13")).toMatchObject({ timing: "OVERDUE", owner: "FIRM", severity: "RED" });
  });
});

// ─── Dauerfristverlängerung ─────────────────────────────────────────────────

describe("Dauerfristverlängerung", () => {
  // Same facts, two profiles: monthly filer, August UStVA not yet filed, as of 2 Oct 2026.
  const done = ["KONTOAUSZUEGE 2026-08", "EINGANGSRECHNUNGEN 2026-08", "LOHN 2026-08", "LOHN 2026-09"];
  const without = fromProfile({ ...WEBER, hasDauerfristverlaengerung: false }, "A", { done });
  const withDF = fromProfile(WEBER, "B", { done });

  const augUstva = (f: typeof without) =>
    computeGaps({ asOf: "2026-10-02", clients: [f.client], obligations: f.obligations }).clients[0].gaps.find(
      (g) => g.typeCode === "USTVA" && g.periodStart === "2026-08-01",
    );

  it("without extension: August UStVA was due 10 Sep → overdue by 22 days", () => {
    expect(augUstva(without)).toMatchObject({ dueDate: "2026-09-10", timing: "OVERDUE", daysUntilDue: -22 });
  });

  it("with extension: due 10 Oct, a Saturday → 12 Oct → upcoming, not overdue", () => {
    expect(augUstva(withDF)).toMatchObject({ dueDate: "2026-10-12", timing: "UPCOMING", daysUntilDue: 10 });
  });

  it("extension shifts client Belege too (⚠ firm rule) but NOT Lohn", () => {
    const report = computeGaps({ asOf: "2026-10-02", clients: [withDF.client], obligations: withDF.obligations });
    const due = (code: string, month: string) =>
      report.clients[0].gaps.find((g) => g.typeCode === code && g.periodStart === `${month}-01`)?.dueDate;
    expect(due("KONTOAUSZUEGE", "2026-09")).toBe("2026-11-05");
    expect(due("LOHN", "2026-07")).toBe("2026-07-15");
  });
});

// ─── Client without payroll ─────────────────────────────────────────────────

describe("client without payroll", () => {
  it("never has a Lohn gap, even with nothing delivered at all", () => {
    const { client, obligations } = fromProfile(SCHMIDT, "10002");
    const report = computeGaps({ asOf: "2026-12-31", clients: [client], obligations });
    expect(report.clients[0].gaps.map((g) => g.typeCode)).not.toContain("LOHN");
    expect(report.clients[0].gaps.length).toBeGreaterThan(0); // sanity: other gaps do exist
  });

  it("is GREEN when everything that applies to it is done", () => {
    const all = ["2026-07", "2026-08", "2026-09"].flatMap((m) => [`KONTOAUSZUEGE ${m}`, `EINGANGSRECHNUNGEN ${m}`]);
    const { client, obligations } = fromProfile(SCHMIDT, "10002", { done: [...all, "USTVA 2026-09"] });
    const c = computeGaps({ asOf: "2026-10-20", clients: [client], obligations }).clients[0];
    expect(c).toMatchObject({ rag: "GREEN", gaps: [] });
  });

  it("a VAT-exempt client (no UStVA) is not flagged for a missing UStVA", () => {
    const { client, obligations } = fromProfile(FISCHER, "10004");
    const report = computeGaps({ asOf: "2026-12-31", clients: [client], obligations });
    expect(report.clients[0].gaps.map((g) => g.typeCode)).not.toContain("USTVA");
  });
});

// ─── Receipt state and status ───────────────────────────────────────────────

describe("receipt state and stored status", () => {
  it("COMPLETE and WAIVED obligations are never gaps, even when overdue", () => {
    const c = computeGaps({
      asOf: "2026-12-31",
      clients: [C1],
      obligations: [ob({ status: "COMPLETE", dueDate: "2026-01-01" }), ob({ status: "WAIVED", dueDate: "2026-01-01" })],
    }).clients[0];
    expect(c).toMatchObject({ rag: "GREEN", gaps: [], counts: { closed: 2 } });
  });

  it("fewer than minDocuments confirmed → PARTIAL, still owed by the client", () => {
    const gap = single("2026-10-06", ob({ minDocuments: 3, confirmedDocumentCount: 1 })).gaps[0];
    expect(gap).toMatchObject({ receipt: "PARTIAL", owner: "CLIENT", severity: "RED" });
  });

  it("enough documents but not closed (Eingangsrechnungen) → AWAITING_CLOSE, owner FIRM", () => {
    const o = ob({ typeCode: "EINGANGSRECHNUNGEN", requiresManualCompletion: true, confirmedDocumentCount: 2 });
    expect(single("2026-10-02", o).gaps[0]).toMatchObject({ receipt: "AWAITING_CLOSE", owner: "FIRM", severity: "AMBER" });
  });

  it("overdue AWAITING_CLOSE is AMBER, not RED: the client delivered, staff must close", () => {
    const o = ob({ requiresManualCompletion: true, confirmedDocumentCount: 2, dueDate: "2026-09-07" });
    expect(single("2026-10-02", o)).toMatchObject({ rag: "AMBER", gaps: [expect.objectContaining({ timing: "OVERDUE", severity: "AMBER" })] });
  });

  it("an upcoming obligation alone keeps the client GREEN", () => {
    expect(single("2026-10-02", ob({ dueDate: "2026-11-05" })).rag).toBe("GREEN");
  });
});

// ─── Ordering ───────────────────────────────────────────────────────────────

describe("ordering by urgency", () => {
  it("gaps within a client: RED before AMBER before GREEN, then by due date", () => {
    const c = computeGaps({
      asOf: "2026-10-02",
      clients: [C1],
      obligations: [
        ob({ id: "upcoming", dueDate: "2026-11-05" }),
        ob({ id: "soon", dueDate: "2026-10-05" }),
        ob({ id: "late-recent", dueDate: "2026-09-15" }),
        ob({ id: "late-old", dueDate: "2026-08-17" }),
      ],
    }).clients[0];
    expect(c.gaps.map((g) => g.obligationId)).toEqual(["late-old", "late-recent", "soon", "upcoming"]);
    expect(c.rag).toBe("RED");
  });

  it("clients: RED first, then AMBER, then GREEN; ties broken by earliest due date, then client number", () => {
    const clients: GapClient[] = [
      { id: "green", clientNumber: "1", name: "g" },
      { id: "amber", clientNumber: "2", name: "a" },
      { id: "red-later", clientNumber: "3", name: "r2" },
      { id: "red-earlier", clientNumber: "4", name: "r1" },
      { id: "empty", clientNumber: "0", name: "e" },
    ];
    const report = computeGaps({
      asOf: "2026-10-02",
      clients,
      obligations: [
        ob({ clientId: "green", dueDate: "2026-11-30" }),
        ob({ clientId: "amber", dueDate: "2026-10-05" }),
        ob({ clientId: "red-later", dueDate: "2026-09-20" }),
        ob({ clientId: "red-earlier", dueDate: "2026-09-01" }),
      ],
    });
    expect(report.clients.map((c) => c.clientId)).toEqual(["red-earlier", "red-later", "amber", "green", "empty"]);
  });
});

// ─── Determinism ────────────────────────────────────────────────────────────

describe("determinism", () => {
  const fixtures = [
    fromProfile(MUELLER, "10001", { done: ["LOHN 2026-07", "KONTOAUSZUEGE 2026-07"] }),
    fromProfile(SCHMIDT, "10002", { docs: { "EINGANGSRECHNUNGEN 2026-09": 1 } }),
    fromProfile(WEBER, "10003", { done: ["LOHN 2026-07"] }),
    fromProfile(FISCHER, "10004", { docs: { "EINGANGSRECHNUNGEN 2026-08": 2 } }),
  ];
  const input: GapInput = {
    asOf: "2026-10-02",
    clients: fixtures.map((f) => f.client),
    obligations: fixtures.flatMap((f) => f.obligations),
  };

  it("running twice on the same data gives identical results", () => {
    expect(computeGaps(input)).toEqual(computeGaps(input));
  });

  it("input order does not matter (clients and obligations reversed)", () => {
    const reversed: GapInput = { ...input, clients: [...input.clients].reverse(), obligations: [...input.obligations].reverse() };
    expect(computeGaps(reversed)).toEqual(computeGaps(input));
  });

  it("does not mutate its input", () => {
    const frozen = structuredClone(input);
    computeGaps(input);
    expect(input).toEqual(frozen);
  });

  it("does not read the clock: the result depends only on asOf", () => {
    const a = computeGaps(input);
    const realNow = Date.now;
    Date.now = () => Date.parse("2030-01-01T00:00:00Z");
    try {
      expect(computeGaps(input)).toEqual(a);
    } finally {
      Date.now = realNow;
    }
  });
});
