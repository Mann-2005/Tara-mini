// Marks an obligation COMPLETE (with audit). No-op unless it is OPEN.

import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "../audit";

export async function completeObligation(
  tx: Prisma.TransactionClient,
  obligationId: string,
  actor: string,
  at: Date,
  reason: string,
): Promise<boolean> {
  // Conditional update: only one caller can move OPEN → COMPLETE.
  const moved = await tx.obligation.updateMany({
    where: { id: obligationId, status: "OPEN" },
    data: { status: "COMPLETE", completedAt: at, completedBy: actor },
  });
  if (moved.count === 0) return false;
  await writeAudit(tx, {
    actor,
    action: "obligation.statusChanged",
    entityType: "Obligation",
    entityId: obligationId,
    oldValue: { status: "OPEN" },
    newValue: { status: "COMPLETE" },
    reason,
  });
  return true;
}
