// Gathers the facts the gap engine needs from the database.
// No judgement here — every rule lives in src/domain/gaps/gapEngine.ts.

import type { PrismaClient } from "@/generated/prisma/client";
import { dbToIsoDate, type IsoDate } from "@/domain/calendar/isoDate";
import type { GapInput } from "@/domain/gaps/gapEngine";

export async function loadGapInput(db: PrismaClient, asOf: IsoDate): Promise<GapInput> {
  const clients = await db.client.findMany({
    where: { isActive: true },
    select: { id: true, clientNumber: true, name: true },
  });

  const obligations = await db.obligation.findMany({
    where: { clientId: { in: clients.map((c) => c.id) } },
    include: {
      obligationType: true,
      _count: {
        select: {
          // Only links that are not revoked AND whose classification a human confirmed.
          fulfilments: { where: { revokedAt: null, classification: { confirmedAt: { not: null } } } },
        },
      },
    },
  });

  return {
    asOf,
    clients,
    obligations: obligations.map((o) => ({
      id: o.id,
      clientId: o.clientId,
      typeCode: o.obligationType.code,
      typeName: o.obligationType.name,
      kind: o.obligationType.kind,
      periodStart: dbToIsoDate(o.periodStart),
      periodEnd: dbToIsoDate(o.periodEnd),
      dueDate: dbToIsoDate(o.dueDate),
      status: o.status,
      minDocuments: o.obligationType.minDocuments,
      requiresManualCompletion: o.obligationType.requiresManualCompletion,
      confirmedDocumentCount: o._count.fulfilments,
    })),
  };
}
