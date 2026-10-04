// Gathers the facts the V2 analytics need, per active client. No judgement
// here: everything is decided by the pure computeClientInsights.
//
// Time travel: only documents uploaded (Berlin date) on or before the as-of
// date are included, and only fulfilment uploads by then count as delivered.
// LIMITATION: a document uploaded before as-of but confirmed after it is
// still treated as confirmed (confirmation time is not replayed).

import type { PrismaClient } from "@/generated/prisma/client";
import { dbToIsoDate, type IsoDate } from "@/domain/calendar/isoDate";
import type { InsightObligation, InsightsInput } from "@/domain/analytics/insights";
import type { AnalyticsDocument } from "@/domain/analytics/types";
import { germanDate } from "../clock";

const money = (d: { toFixed(digits: number): string } | null) => (d === null ? null : d.toFixed(2));

export async function loadInsightsInputs(db: PrismaClient, asOf: IsoDate): Promise<InsightsInput[]> {
  const clients = await db.client.findMany({
    where: { isActive: true },
    select: { id: true, vatFilingFrequency: true },
    orderBy: { clientNumber: "asc" },
  });
  const clientIds = clients.map((c) => c.id);

  const [documents, obligations] = await Promise.all([
    db.document.findMany({
      where: { clientId: { in: clientIds }, status: { in: ["CONFIRMED", "PROPOSED"] } },
      include: { classifications: { orderBy: { createdAt: "asc" } } },
    }),
    db.obligation.findMany({
      where: { clientId: { in: clientIds } },
      include: {
        obligationType: true,
        fulfilments: {
          where: { revokedAt: null, classification: { confirmedAt: { not: null } } },
          include: { document: { select: { uploadedAt: true } } },
        },
      },
    }),
  ]);

  const docsByClient = new Map<string, AnalyticsDocument[]>();
  for (const d of documents) {
    if (germanDate(d.uploadedAt) > asOf) continue;
    // CONFIRMED → the confirmed classification (LLM row or HUMAN correction); PROPOSED → the latest LLM proposal.
    const c =
      d.status === "CONFIRMED"
        ? d.classifications.find((x) => x.confirmedAt !== null)
        : [...d.classifications].reverse().find((x) => x.source === "LLM");
    if (!c) continue;
    const list = docsByClient.get(d.clientId) ?? [];
    list.push({
      documentId: d.id,
      clientId: d.clientId,
      status: d.status as "CONFIRMED" | "PROPOSED",
      documentType: c.documentType,
      documentDate: c.documentDate ? dbToIsoDate(c.documentDate) : null,
      amount: money(c.amount),
      vatAmount: money(c.vatAmount),
      currency: c.currency,
      counterparty: c.counterparty,
    });
    docsByClient.set(d.clientId, list);
  }

  const obligationsByClient = new Map<string, InsightObligation[]>();
  for (const o of obligations) {
    const list = obligationsByClient.get(o.clientId) ?? [];
    list.push({
      id: o.id,
      typeCode: o.obligationType.code,
      typeName: o.obligationType.name,
      kind: o.obligationType.kind,
      status: o.status,
      periodStart: dbToIsoDate(o.periodStart),
      periodEnd: dbToIsoDate(o.periodEnd),
      dueDate: dbToIsoDate(o.dueDate),
      minDocuments: o.obligationType.minDocuments,
      completedAt: o.completedAt ? germanDate(o.completedAt) : null,
      deliveryDates: o.fulfilments.map((f) => germanDate(f.document.uploadedAt)),
      acceptedDocumentTypes: o.obligationType.acceptedDocumentTypes,
    });
    obligationsByClient.set(o.clientId, list);
  }

  return clients.map((c) => ({
    client: { id: c.id, vatFilingFrequency: c.vatFilingFrequency },
    asOf,
    documents: docsByClient.get(c.id) ?? [],
    obligations: obligationsByClient.get(c.id) ?? [],
  }));
}
