// Persists generator output idempotently.
//
// For each spec from the pure generator:
// - missing        → create it (audit "obligation.created")
// - exists, OPEN, due date differs (e.g. client was granted
//   Dauerfristverlängerung) → update dueDate (audit "obligation.dueDateChanged")
// - otherwise      → leave untouched. COMPLETE/WAIVED obligations are history
//                    and are never rewritten.
// Running it twice on the same data changes nothing the second time.

import type { PrismaClient } from "@/generated/prisma/client";
import { dbToIsoDate, isoDateToDb, type IsoMonth } from "@/domain/calendar/isoDate";
import { generateObligations } from "@/domain/obligations/generate";
import type { ClientProfile, ObligationRule } from "@/domain/obligations/types";
import { writeAudit } from "../audit";

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
}

export async function syncObligations(
  db: PrismaClient,
  client: ClientProfile,
  rules: readonly ObligationRule[],
  fromMonth: IsoMonth,
  toMonth: IsoMonth,
  actor: string,
): Promise<SyncResult> {
  const specs = generateObligations(client, rules, fromMonth, toMonth);
  const result: SyncResult = { created: 0, updated: 0, unchanged: 0 };

  await db.$transaction(async (tx) => {
    for (const spec of specs) {
      const key = {
        clientId: spec.clientId,
        obligationTypeId: spec.obligationTypeId,
        periodStart: isoDateToDb(spec.periodStart),
      };
      const existing = await tx.obligation.findUnique({
        where: { clientId_obligationTypeId_periodStart: key },
      });

      if (!existing) {
        const created = await tx.obligation.create({
          data: { ...key, periodEnd: isoDateToDb(spec.periodEnd), dueDate: isoDateToDb(spec.dueDate) },
        });
        await writeAudit(tx, {
          actor,
          action: "obligation.created",
          entityType: "Obligation",
          entityId: created.id,
          newValue: { type: spec.obligationTypeCode, periodStart: spec.periodStart, periodEnd: spec.periodEnd, dueDate: spec.dueDate },
        });
        result.created++;
      } else if (existing.status === "OPEN" && dbToIsoDate(existing.dueDate) !== spec.dueDate) {
        await tx.obligation.update({ where: { id: existing.id }, data: { dueDate: isoDateToDb(spec.dueDate) } });
        await writeAudit(tx, {
          actor,
          action: "obligation.dueDateChanged",
          entityType: "Obligation",
          entityId: existing.id,
          oldValue: { dueDate: dbToIsoDate(existing.dueDate) },
          newValue: { dueDate: spec.dueDate },
          reason: "Recomputed from current client profile and obligation rules",
        });
        result.updated++;
      } else {
        result.unchanged++;
      }
    }
  });

  return result;
}
