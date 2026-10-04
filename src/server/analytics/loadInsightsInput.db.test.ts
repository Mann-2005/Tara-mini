// Integration test for the V2 insights loader (isolated tara_mini_test DB).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isoDateToDb } from "@/domain/calendar/isoDate";
import { STANDARD_OBLIGATION_TYPES } from "@/domain/obligations/standardTypes";
import { db } from "@/lib/db";
import { loadInsightsInputs } from "./loadInsightsInput";

const AS_OF = "2026-10-02";
let clientId: string;
let obligationId: string;
const ids: Record<string, string> = {};

async function document(key: string, status: "PENDING" | "PROPOSED" | "CONFIRMED" | "REJECTED", uploadedAt: string) {
  const d = await db.document.create({
    data: {
      clientId,
      filename: `${key}.pdf`,
      mimeType: "application/pdf",
      storagePath: `test/${key}.pdf`,
      sha256: `sha-${key}-${Date.now()}`,
      sizeBytes: 1,
      uploadedBy: "staff:test",
      uploadedAt: new Date(uploadedAt),
      status,
    },
  });
  ids[key] = d.id;
  return d;
}

async function llm(documentId: string, counterparty: string, confirmed = false) {
  return db.documentClassification.create({
    data: {
      documentId,
      source: "LLM",
      documentType: "INCOMING_INVOICE",
      documentDate: isoDateToDb("2026-09-03"),
      amount: "47.60",
      vatAmount: "7.60",
      counterparty,
      confidence: 0.9,
      modelUsed: "test-model",
      createdBy: "llm:test-model",
      ...(confirmed ? { confirmedBy: "staff:test", confirmedAt: new Date("2026-09-04T10:00:00Z") } : {}),
    },
  });
}

beforeAll(async () => {
  for (const t of STANDARD_OBLIGATION_TYPES) await db.obligationType.upsert({ where: { code: t.code }, create: t, update: {} });
  const client = await db.client.create({
    data: {
      name: "Loader Test GmbH",
      clientNumber: `L${Date.now()}`,
      fiscalYearEndMonth: 12,
      vatFilingFrequency: "MONTHLY",
      hasPayroll: false,
      hasDauerfristverlaengerung: false,
      federalState: "NW",
    },
  });
  clientId = client.id;
  const eing = await db.obligationType.findUniqueOrThrow({ where: { code: "EINGANGSRECHNUNGEN" } });
  const obligation = await db.obligation.create({
    data: {
      clientId,
      obligationTypeId: eing.id,
      periodStart: isoDateToDb("2026-09-01"),
      periodEnd: isoDateToDb("2026-09-30"),
      dueDate: isoDateToDb("2026-10-05"),
      status: "COMPLETE",
      completedAt: new Date("2026-09-30T22:30:00Z"), // 1 Oct in Berlin
      completedBy: "staff:test",
    },
  });
  obligationId = obligation.id;

  // Confirmed with a human correction of the counterparty.
  const corrected = await document("corrected", "CONFIRMED", "2026-09-04T10:00:00Z");
  const proposal = await llm(corrected.id, "Physiotherapie Weber"); // model picked the recipient
  const human = await db.documentClassification.create({
    data: {
      documentId: corrected.id,
      source: "HUMAN",
      documentType: "INCOMING_INVOICE",
      documentDate: isoDateToDb("2026-09-03"),
      amount: "47.60",
      vatAmount: "7.60",
      counterparty: "Telefónica Germany GmbH & Co. OHG",
      supersedesId: proposal.id,
      createdBy: "staff:test",
      confirmedBy: "staff:test",
      confirmedAt: new Date("2026-09-04T10:00:00Z"),
    },
  });
  await db.obligationFulfilment.create({ data: { obligationId, documentId: corrected.id, classificationId: human.id, createdBy: "staff:test" } });

  // Proposed (not reviewed): the LLM fields are used.
  await llm((await document("proposed", "PROPOSED", "2026-09-05T10:00:00Z")).id, "Hetzner Online GmbH");

  // A revoked fulfilment never counts as a delivery.
  const revoked = await document("revoked", "CONFIRMED", "2026-09-06T10:00:00Z");
  const revokedClass = await llm(revoked.id, "Revoked Vendor", true);
  await db.obligationFulfilment.create({
    data: { obligationId, documentId: revoked.id, classificationId: revokedClass.id, createdBy: "staff:test", revokedAt: new Date(), revokedBy: "staff:test", revokeReason: "wrong period" },
  });

  // Excluded: rejected, pending, uploaded after as-of, and 23:30 UTC on 2 Oct (= 3 Oct in Berlin).
  await llm((await document("rejected", "REJECTED", "2026-09-07T10:00:00Z")).id, "X");
  await document("pending", "PENDING", "2026-09-08T10:00:00Z");
  await llm((await document("future", "CONFIRMED", "2026-10-10T10:00:00Z")).id, "Future GmbH", true);
  await llm((await document("berlinMidnight", "CONFIRMED", "2026-10-02T23:30:00Z")).id, "Late Night GmbH", true);
});

afterAll(() => db.$disconnect());

describe("loadInsightsInputs", () => {
  it("maps confirmed and proposed documents known by the as-of date", async () => {
    const input = (await loadInsightsInputs(db, AS_OF)).find((i) => i.client.id === clientId)!;
    expect(input.client).toEqual({ id: clientId, vatFilingFrequency: "MONTHLY" });
    expect(input.asOf).toBe(AS_OF);

    const byId = new Map(input.documents.map((d) => [d.documentId, d]));
    expect([...byId.keys()].sort()).toEqual([ids.corrected, ids.proposed, ids.revoked].sort());

    // Confirmed → the HUMAN correction, not the model's guess; money as exact strings.
    expect(byId.get(ids.corrected)).toEqual({
      documentId: ids.corrected,
      clientId,
      status: "CONFIRMED",
      documentType: "INCOMING_INVOICE",
      documentDate: "2026-09-03",
      amount: "47.60",
      vatAmount: "7.60",
      currency: "EUR",
      counterparty: "Telefónica Germany GmbH & Co. OHG",
    });
    expect(byId.get(ids.proposed)).toMatchObject({ status: "PROPOSED", counterparty: "Hetzner Online GmbH" });
  });

  it("maps obligations with Berlin-date deliveries, ignoring revoked links", async () => {
    const input = (await loadInsightsInputs(db, AS_OF)).find((i) => i.client.id === clientId)!;
    expect(input.obligations).toEqual([
      {
        id: obligationId,
        typeCode: "EINGANGSRECHNUNGEN",
        typeName: "Eingangsrechnungen",
        kind: "CLIENT_DELIVERY",
        status: "COMPLETE",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        dueDate: "2026-10-05",
        minDocuments: 1,
        completedAt: "2026-10-01", // 22:30 UTC on 30 Sep is 1 Oct in Berlin
        deliveryDates: ["2026-09-04"],
        acceptedDocumentTypes: ["INCOMING_INVOICE", "RECEIPT"],
      },
    ]);
  });

  it("a later as-of date includes the documents uploaded by then", async () => {
    const input = (await loadInsightsInputs(db, "2026-10-03")).find((i) => i.client.id === clientId)!;
    expect(input.documents.map((d) => d.documentId)).toContain(ids.berlinMidnight);
    expect(input.documents.map((d) => d.documentId)).not.toContain(ids.future);
  });
});
