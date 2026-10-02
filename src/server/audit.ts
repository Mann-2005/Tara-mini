// Append-only audit log writer (GoBD traceability).
// Call it inside the same transaction as the change it records, so a change
// and its audit entry are committed (or rolled back) together.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/** Either the root client or a transaction client. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface AuditInput {
  /** "staff:<name>", "system:<process>" or "llm:<model>". */
  actor: string;
  /** Dotted verb, e.g. "obligation.created", "classification.confirmed". */
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  reason?: string;
}

export function writeAudit(db: DbClient, event: AuditInput) {
  return db.auditEvent.create({ data: event });
}
