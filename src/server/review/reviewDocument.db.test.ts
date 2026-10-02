// Integration tests for the review flow against the isolated test database
// (tara_mini_test, schema rebuilt from migrations incl. GoBD triggers).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isoDateToDb } from "@/domain/calendar/isoDate";
import { STANDARD_OBLIGATION_TYPES } from "@/domain/obligations/standardTypes";
import { db } from "@/lib/db";
import type { ClassificationFields } from "./fields";
import { confirmDocument, rejectDocument, ReviewError } from "./reviewDocument";

const ACTOR = "staff:test";
let seq = 0;

const KRAEMER: ClassificationFields = {
  documentType: "INCOMING_INVOICE",
  documentDate: "2026-09-15",
  amount: "8925.00",
  vatAmount: "1425.00",
  currency: "EUR",
  counterparty: "Baustoffhandel Krämer GmbH",
};
const STATEMENT: ClassificationFields = {
  documentType: "BANK_STATEMENT",
  documentDate: "2026-09-30",
  amount: null,
  vatAmount: null,
  currency: "EUR",
  counterparty: "Sparkasse Essen",
};

beforeAll(async () => {
  for (const t of STANDARD_OBLIGATION_TYPES) {
    await db.obligationType.upsert({ where: { code: t.code }, create: t, update: {} });
  }
});
afterAll(() => db.$disconnect());

/** A fresh client with September obligations and one PROPOSED document carrying `llm`. */
async function scenario(llm: ClassificationFields) {
  const n = ++seq;
  const client = await db.client.create({
    data: {
      name: `Test Client ${n}`,
      clientNumber: `T${Date.now()}${n}`,
      fiscalYearEndMonth: 12,
      vatFilingFrequency: "MONTHLY",
      hasPayroll: false,
      hasDauerfristverlaengerung: false,
      federalState: "NW",
    },
  });
  const types = Object.fromEntries((await db.obligationType.findMany()).map((t) => [t.code, t]));
  const obligation = async (code: string) =>
    db.obligation.create({
      data: {
        clientId: client.id,
        obligationTypeId: types[code].id,
        periodStart: isoDateToDb("2026-09-01"),
        periodEnd: isoDateToDb("2026-09-30"),
        dueDate: isoDateToDb("2026-10-05"),
      },
    });
  const konto = await obligation("KONTOAUSZUEGE");
  const eing = await obligation("EINGANGSRECHNUNGEN");

  const document = await db.document.create({
    data: {
      clientId: client.id,
      filename: `doc-${n}.pdf`,
      mimeType: "application/pdf",
      storagePath: `test/${n}.pdf`,
      sha256: `sha-${n}-${Date.now()}`,
      sizeBytes: 1000,
      uploadedBy: ACTOR,
      status: "PROPOSED",
    },
  });
  const proposal = await db.documentClassification.create({
    data: {
      documentId: document.id,
      source: "LLM",
      documentType: llm.documentType,
      documentDate: llm.documentDate ? isoDateToDb(llm.documentDate) : null,
      amount: llm.amount,
      vatAmount: llm.vatAmount,
      currency: llm.currency,
      counterparty: llm.counterparty,
      confidence: 0.9,
      modelUsed: "test-model",
      createdBy: "llm:test-model",
    },
  });
  return { client, konto, eing, document, proposal };
}

const auditActions = async (entityIds: string[]) =>
  (await db.auditEvent.findMany({ where: { entityId: { in: entityIds } }, orderBy: { occurredAt: "asc" } })).map((e) => e.action);

describe("confirm without changes", () => {
  it("confirms the LLM row itself, fulfils and completes a single-document obligation", async () => {
    const s = await scenario(STATEMENT);
    const r = await confirmDocument(db, { documentId: s.document.id, actor: ACTOR, fields: STATEMENT, obligationId: s.konto.id, closePeriod: false });

    expect(r).toMatchObject({ outcome: "confirmed", classificationId: s.proposal.id, changed: [], obligationCompleted: true });

    const rows = await db.documentClassification.findMany({ where: { documentId: s.document.id } });
    expect(rows).toHaveLength(1); // no HUMAN row
    expect(rows[0]).toMatchObject({ source: "LLM", confirmedBy: ACTOR });
    expect(rows[0].confirmedAt).not.toBeNull();

    expect(await db.document.findUnique({ where: { id: s.document.id } })).toMatchObject({ status: "CONFIRMED" });
    expect(await db.obligation.findUnique({ where: { id: s.konto.id } })).toMatchObject({ status: "COMPLETE", completedBy: ACTOR });
    const fulfilment = await db.obligationFulfilment.findFirstOrThrow({ where: { documentId: s.document.id } });
    expect(fulfilment).toMatchObject({ obligationId: s.konto.id, classificationId: s.proposal.id, createdBy: ACTOR });

    expect(await auditActions([s.proposal.id, s.document.id, fulfilment.id, s.konto.id])).toEqual([
      "classification.confirmed",
      "document.statusChanged",
      "fulfilment.created",
      "obligation.statusChanged",
    ]);
  });
});

describe("confirm with corrections", () => {
  it("inserts a HUMAN row that supersedes the untouched LLM row, and fulfils with it", async () => {
    const llmGuess: ClassificationFields = { ...KRAEMER, documentType: "RECEIPT", amount: "7500.00" };
    const s = await scenario(llmGuess);

    const r = await confirmDocument(db, { documentId: s.document.id, actor: ACTOR, fields: KRAEMER, obligationId: s.eing.id, closePeriod: false });
    expect(r).toMatchObject({ outcome: "corrected", changed: ["documentType", "amount"] });

    const llmRow = await db.documentClassification.findUniqueOrThrow({ where: { id: s.proposal.id } });
    expect(llmRow).toMatchObject({ source: "LLM", documentType: "RECEIPT", confirmedAt: null, confirmedBy: null });
    expect(llmRow.amount?.toFixed(2)).toBe("7500.00"); // original proposal preserved

    const human = await db.documentClassification.findUniqueOrThrow({ where: { id: r.classificationId } });
    expect(human).toMatchObject({ source: "HUMAN", supersedesId: s.proposal.id, documentType: "INCOMING_INVOICE", createdBy: ACTOR, confirmedBy: ACTOR });
    expect(human.amount?.toFixed(2)).toBe("8925.00");
    expect(human.confidence).toBeNull();
    expect(human.modelUsed).toBeNull();

    const fulfilment = await db.obligationFulfilment.findFirstOrThrow({ where: { documentId: s.document.id } });
    expect(fulfilment.classificationId).toBe(human.id);

    const corrected = await db.auditEvent.findFirstOrThrow({ where: { entityId: human.id, action: "classification.corrected" } });
    expect(corrected.oldValue).toMatchObject({ supersedes: s.proposal.id, documentType: "RECEIPT", amount: "7500.00" });
    expect(corrected.newValue).toEqual({ documentType: "INCOMING_INVOICE", amount: "8925.00" });
  });

  it("the database itself refuses to edit the LLM row (GoBD trigger)", async () => {
    const s = await scenario(KRAEMER);
    await expect(db.documentClassification.update({ where: { id: s.proposal.id }, data: { amount: "1.00" } })).rejects.toThrow(/immutable/);
  });
});

describe("manual completion (Eingangsrechnungen)", () => {
  it("stays OPEN after a confirmed invoice unless the reviewer closes the period", async () => {
    const a = await scenario(KRAEMER);
    const r1 = await confirmDocument(db, { documentId: a.document.id, actor: ACTOR, fields: KRAEMER, obligationId: a.eing.id, closePeriod: false });
    expect(r1.obligationCompleted).toBe(false);
    expect(await db.obligation.findUnique({ where: { id: a.eing.id } })).toMatchObject({ status: "OPEN" });

    const b = await scenario(KRAEMER);
    const r2 = await confirmDocument(db, { documentId: b.document.id, actor: ACTOR, fields: KRAEMER, obligationId: b.eing.id, closePeriod: true });
    expect(r2.obligationCompleted).toBe(true);
    expect(await db.obligation.findUnique({ where: { id: b.eing.id } })).toMatchObject({ status: "COMPLETE" });
  });
});

describe("guards (everything rolls back)", () => {
  it("rejects an obligation of another client", async () => {
    const mine = await scenario(STATEMENT);
    const other = await scenario(STATEMENT);
    await expect(
      confirmDocument(db, { documentId: mine.document.id, actor: ACTOR, fields: STATEMENT, obligationId: other.konto.id, closePeriod: false }),
    ).rejects.toThrow(ReviewError);

    // Nothing was written: still PROPOSED, LLM row unconfirmed, no fulfilment, no audit.
    expect(await db.document.findUnique({ where: { id: mine.document.id } })).toMatchObject({ status: "PROPOSED" });
    expect(await db.documentClassification.findUnique({ where: { id: mine.proposal.id } })).toMatchObject({ confirmedAt: null });
    expect(await db.obligationFulfilment.count({ where: { documentId: mine.document.id } })).toBe(0);
    expect(await auditActions([mine.document.id, mine.proposal.id])).toEqual([]);
  });

  it("rejects an obligation that does not accept the (corrected) document type", async () => {
    const s = await scenario(STATEMENT);
    await expect(
      confirmDocument(db, { documentId: s.document.id, actor: ACTOR, fields: { ...STATEMENT, documentType: "PAYROLL_DATA" }, obligationId: s.konto.id, closePeriod: false }),
    ).rejects.toThrow(/cannot be fulfilled/);
    expect(await db.documentClassification.count({ where: { documentId: s.document.id } })).toBe(1); // HUMAN row rolled back
  });

  it("a document can only be reviewed once, even when two reviews race", async () => {
    const s = await scenario(STATEMENT);
    const attempt = () => confirmDocument(db, { documentId: s.document.id, actor: ACTOR, fields: STATEMENT, obligationId: s.konto.id, closePeriod: false });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.obligationFulfilment.count({ where: { documentId: s.document.id } })).toBe(1);
  });

  it("confirming without linking is allowed and creates no fulfilment", async () => {
    const s = await scenario(STATEMENT);
    const r = await confirmDocument(db, { documentId: s.document.id, actor: ACTOR, fields: STATEMENT, obligationId: null, closePeriod: false });
    expect(r.fulfilmentId).toBeNull();
    expect(await db.obligation.findUnique({ where: { id: s.konto.id } })).toMatchObject({ status: "OPEN" });
  });
});

describe("reject", () => {
  it("keeps the document as REJECTED with the reason in the audit log, never fulfilling anything", async () => {
    const s = await scenario(STATEMENT);
    await rejectDocument(db, { documentId: s.document.id, actor: ACTOR, reason: "Wrong client's statement" });
    expect(await db.document.findUnique({ where: { id: s.document.id } })).toMatchObject({ status: "REJECTED" });
    const e = await db.auditEvent.findFirstOrThrow({ where: { entityId: s.document.id, action: "document.statusChanged" } });
    expect(e.reason).toBe("Wrong client's statement");
    await expect(
      confirmDocument(db, { documentId: s.document.id, actor: ACTOR, fields: STATEMENT, obligationId: s.konto.id, closePeriod: false }),
    ).rejects.toThrow(ReviewError);
  });

  it("requires a reason", async () => {
    const s = await scenario(STATEMENT);
    await expect(rejectDocument(db, { documentId: s.document.id, actor: ACTOR, reason: " " })).rejects.toThrow(ReviewError);
  });
});
