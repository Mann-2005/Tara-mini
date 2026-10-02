// Read models for the review pages.

import type { PrismaClient } from "@/generated/prisma/client";
import { dbToIsoDate } from "@/domain/calendar/isoDate";
import type { LinkableObligation } from "@/domain/fulfilment/matchObligations";
import { originalExists } from "../documents/storage";
import { fieldsFromRow } from "./fields";

export async function loadReviewQueue(db: PrismaClient) {
  return db.document.findMany({
    where: { status: "PROPOSED" },
    orderBy: { uploadedAt: "asc" }, // oldest first: first in, first reviewed
    include: {
      client: { select: { name: true, clientNumber: true } },
      classifications: { where: { source: "LLM" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export async function loadReviewDetail(db: PrismaClient, documentId: string) {
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: {
      client: { select: { id: true, name: true, clientNumber: true } },
      classifications: { orderBy: { createdAt: "asc" } },
      fulfilments: {
        where: { revokedAt: null },
        include: { obligation: { include: { obligationType: true } } },
      },
    },
  });
  if (!document) return null;

  const proposal = [...document.classifications].reverse().find((c) => c.source === "LLM") ?? null;
  const confirmed = document.classifications.find((c) => c.confirmedAt !== null) ?? null;

  const obligations = await db.obligation.findMany({
    where: { clientId: document.clientId },
    include: { obligationType: true },
  });
  const linkable: LinkableObligation[] = obligations.map((o) => ({
    id: o.id,
    typeCode: o.obligationType.code,
    typeName: o.obligationType.name,
    kind: o.obligationType.kind,
    acceptedDocumentTypes: o.obligationType.acceptedDocumentTypes,
    requiresManualCompletion: o.obligationType.requiresManualCompletion,
    periodStart: dbToIsoDate(o.periodStart),
    periodEnd: dbToIsoDate(o.periodEnd),
    dueDate: dbToIsoDate(o.dueDate),
    status: o.status,
  }));

  return {
    document,
    proposal: proposal && {
      id: proposal.id,
      fields: fieldsFromRow(proposal),
      confidence: proposal.confidence,
      modelUsed: proposal.modelUsed,
    },
    confirmed: confirmed && { ...confirmed, fields: fieldsFromRow(confirmed) },
    obligations: linkable,
    hasOriginal: await originalExists(document.storagePath),
  };
}
