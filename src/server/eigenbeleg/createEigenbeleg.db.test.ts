// Integration tests for the Eigenbeleg workflow (isolated tara_mini_test DB).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isoDateToDb } from "@/domain/calendar/isoDate";
import { STANDARD_OBLIGATION_TYPES } from "@/domain/obligations/standardTypes";
import { db } from "@/lib/db";
import { loadReviewedPairs } from "../accuracy/loadAccuracy";
import { readOriginal } from "../documents/storage";
import { fieldsFromRow } from "../review/fields";
import { confirmDocument } from "../review/reviewDocument";
import { createEigenbeleg, EigenbelegError, type EigenbelegRequest } from "./createEigenbeleg";

const NOW = new Date("2026-10-04T09:00:00Z");
let clientNumber: string;
let eingId: string;
let kontoId: string;

const request = (overrides: Partial<EigenbelegRequest> = {}): EigenbelegRequest => ({
  obligationId: eingId,
  expenseDate: "2026-09-03",
  payee: "Telefónica Germany GmbH & Co. OHG",
  description: "O2 Business Mobilfunk, September 2026",
  grossAmount: "47.60",
  reason: "LOST",
  reasonDetail: "",
  businessPurpose: "Diensthandy des Bauleiters für Baustellenkommunikation",
  digitallyConfirmedBy: null,
  actor: "staff:test",
  ...overrides,
});

beforeAll(async () => {
  for (const t of STANDARD_OBLIGATION_TYPES) await db.obligationType.upsert({ where: { code: t.code }, create: t, update: {} });
  clientNumber = `E${Date.now()}`;
  const client = await db.client.create({
    data: { name: "Eigenbeleg Test GmbH", clientNumber, fiscalYearEndMonth: 12, vatFilingFrequency: "MONTHLY", hasPayroll: false, hasDauerfristverlaengerung: false, federalState: "NW" },
  });
  const types = Object.fromEntries((await db.obligationType.findMany()).map((t) => [t.code, t.id]));
  const make = (code: string) =>
    db.obligation.create({
      data: { clientId: client.id, obligationTypeId: types[code], periodStart: isoDateToDb("2026-09-01"), periodEnd: isoDateToDb("2026-09-30"), dueDate: isoDateToDb("2026-10-05") },
    });
  eingId = (await make("EINGANGSRECHNUNGEN")).id;
  kontoId = (await make("KONTOAUSZUEGE")).id;
});

afterAll(() => db.$disconnect());

describe("createEigenbeleg", () => {
  it("stores a PDF voucher as a PROPOSED receipt with a staff-entered, unconfirmed classification", async () => {
    const r = await createEigenbeleg(db, request(), NOW);
    expect(r).toMatchObject({ voucherNumber: `EB-${clientNumber}-0001`, warnings: [] });

    const doc = await db.document.findUniqueOrThrow({ where: { id: r.documentId }, include: { classifications: true } });
    expect(doc).toMatchObject({ status: "PROPOSED", origin: "EIGENBELEG", mimeType: "application/pdf", filename: `Eigenbeleg_EB-${clientNumber}-0001.pdf`, uploadedBy: "staff:test" });
    expect(doc.rawText).toContain("Kein Vorsteuerabzug");

    // The stored file is the PDF and still matches its hash (GoBD integrity).
    const bytes = await readOriginal(doc.storagePath, doc.sha256);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    expect(doc.classifications).toHaveLength(1);
    expect(doc.classifications[0]).toMatchObject({ source: "HUMAN", confirmedAt: null, createdBy: "staff:test", supersedesId: null });
    expect(fieldsFromRow(doc.classifications[0])).toEqual({
      documentType: "RECEIPT",
      documentDate: "2026-09-03",
      amount: "47.60",
      vatAmount: "0.00",
      currency: "EUR",
      counterparty: "Telefónica Germany GmbH & Co. OHG",
    });

    const actions = (await db.auditEvent.findMany({ where: { entityId: { in: [doc.id, doc.classifications[0].id] } }, orderBy: { occurredAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["document.uploaded", "eigenbeleg.created", "classification.proposed"]);
  });

  it("numbers vouchers sequentially per client and passes warnings through", async () => {
    const r = await createEigenbeleg(db, request({ grossAmount: "300.00", payee: "Baumarkt", description: "Kleinmaterial" }), NOW);
    expect(r.voucherNumber).toBe(`EB-${clientNumber}-0002`);
    expect(r.warnings).toEqual([expect.stringMatching(/Over 250 EUR/)]);
  });

  it("confirming it on review links it to the obligation; it never counts as AI output", async () => {
    const r = await createEigenbeleg(db, request({ payee: "Parkhaus Zentrum", description: "Parkgebühr Baustellentermin", grossAmount: "6.00", reason: "NO_RECEIPT_ISSUED" }), NOW);
    const proposal = await db.documentClassification.findFirstOrThrow({ where: { documentId: r.documentId } });
    const result = await confirmDocument(db, {
      documentId: r.documentId,
      actor: "staff:reviewer",
      fields: fieldsFromRow(proposal),
      obligationId: eingId,
      closePeriod: false,
    });
    expect(result).toMatchObject({ outcome: "confirmed", classificationId: proposal.id });
    expect(await db.obligationFulfilment.count({ where: { documentId: r.documentId, obligationId: eingId } })).toBe(1);
    expect(await db.document.findUnique({ where: { id: r.documentId } })).toMatchObject({ status: "CONFIRMED" });

    // Accuracy measures the model only: a staff-entered Eigenbeleg is not a model proposal.
    expect((await loadReviewedPairs(db)).map((p) => p.documentId)).not.toContain(r.documentId);
  });

  it("corrections on review supersede the staff entry, which stays unchanged", async () => {
    const r = await createEigenbeleg(db, request({ payee: "Kiosk am Bahnhof", description: "Getränke Baustellenbesprechung", grossAmount: "12.40" }), NOW);
    const original = await db.documentClassification.findFirstOrThrow({ where: { documentId: r.documentId } });
    const result = await confirmDocument(db, {
      documentId: r.documentId,
      actor: "staff:reviewer",
      fields: { ...fieldsFromRow(original), amount: "12.90" },
      obligationId: eingId,
      closePeriod: false,
    });
    expect(result).toMatchObject({ outcome: "corrected", changed: ["amount"] });
    expect(await db.documentClassification.findUnique({ where: { id: original.id } })).toMatchObject({ confirmedAt: null });
  });

  it.each([
    ["an obligation that cannot take receipts", () => request({ obligationId: kontoId }), /cannot fulfil Kontoauszüge/],
    ["an unknown obligation", () => request({ obligationId: "00000000-0000-0000-0000-000000000000" }), /Choose the obligation/],
    ["an expense outside the period", () => request({ expenseDate: "2026-08-15" }), /Some fields need fixing/],
  ])("rejects %s and writes nothing", async (_label, make, message) => {
    const before = await db.document.count();
    await expect(createEigenbeleg(db, make(), NOW)).rejects.toThrow(message);
    expect(await db.document.count()).toBe(before);
  });

  it("reports field errors for the form", async () => {
    const error = await createEigenbeleg(db, request({ expenseDate: "2026-08-15", businessPurpose: "x" }), NOW).catch((e) => e);
    expect(error).toBeInstanceOf(EigenbelegError);
    expect(Object.keys(error.fieldErrors).sort()).toEqual(["businessPurpose", "expenseDate"]);
  });

  it("rejects a waived obligation", async () => {
    await db.obligation.update({ where: { id: kontoId }, data: { status: "WAIVED" } });
    const eingType = await db.obligationType.findUniqueOrThrow({ where: { code: "EINGANGSRECHNUNGEN" } });
    const waived = await db.obligation.create({
      data: {
        clientId: (await db.obligation.findUniqueOrThrow({ where: { id: eingId } })).clientId,
        obligationTypeId: eingType.id,
        periodStart: isoDateToDb("2026-08-01"),
        periodEnd: isoDateToDb("2026-08-31"),
        dueDate: isoDateToDb("2026-09-07"),
        status: "WAIVED",
      },
    });
    await expect(createEigenbeleg(db, request({ obligationId: waived.id, expenseDate: "2026-08-10" }), NOW)).rejects.toThrow(/waived/);
  });
});
