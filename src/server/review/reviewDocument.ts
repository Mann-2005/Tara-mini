// Human review of an LLM proposal. This is the ONLY path by which a document
// starts to count towards an obligation.
//
// confirmDocument, in one transaction:
//   1. Compare the reviewer's fields with the proposal (the LLM's, or staff's for an Eigenbeleg).
//      - identical → the LLM row is confirmed (its only permitted update)
//      - different → a new HUMAN row is inserted (supersedesId → LLM row) and
//        confirmed; the LLM row is left untouched, so accuracy can be measured
//   2. Document PROPOSED → CONFIRMED
//   3. Optionally link the obligation (ObligationFulfilment) after re-checking
//      that it belongs to the same client and accepts this document type
//   4. Complete the obligation if its rule says so (or the reviewer closed it)
// Every step writes an AuditEvent. Any failure rolls back everything.

import type { PrismaClient } from "@/generated/prisma/client";
import { isLinkAllowed } from "@/domain/fulfilment/matchObligations";
import { isoDateToDb } from "@/domain/calendar/isoDate";
import { writeAudit } from "../audit";
import { completeObligation } from "../obligations/completeObligation";
import { changedFields, fieldsFromRow, type ClassificationFields } from "./fields";

/** A problem the reviewer can understand and fix; safe to show. */
export class ReviewError extends Error {}

export interface ConfirmInput {
  documentId: string;
  actor: string;
  fields: ClassificationFields;
  /** Obligation to fulfil, or null to confirm without linking. */
  obligationId: string | null;
  /** For obligations that need manual completion (e.g. Eingangsrechnungen): close the period now. */
  closePeriod: boolean;
}

export interface ConfirmResult {
  outcome: "confirmed" | "corrected";
  classificationId: string;
  changed: string[];
  fulfilmentId: string | null;
  obligationCompleted: boolean;
}

function toData(f: ClassificationFields) {
  return {
    documentType: f.documentType,
    documentDate: f.documentDate ? isoDateToDb(f.documentDate) : null,
    amount: f.amount,
    vatAmount: f.vatAmount,
    currency: f.currency,
    counterparty: f.counterparty,
  };
}

export async function confirmDocument(db: PrismaClient, input: ConfirmInput): Promise<ConfirmResult> {
  return db.$transaction(async (tx) => {
    const now = new Date();

    // 1. Claim the document: only one review can move it out of PROPOSED.
    const claimed = await tx.document.updateMany({ where: { id: input.documentId, status: "PROPOSED" }, data: { status: "CONFIRMED" } });
    if (claimed.count !== 1) throw new ReviewError("This document is not awaiting review any more. It may have been reviewed already.");

    const document = await tx.document.findUniqueOrThrow({ where: { id: input.documentId } });
    const proposal = await tx.documentClassification.findFirst({
      // The original proposal: the model's (uploads) or staff's (Eigenbelege). Corrections supersede it.
      where: { documentId: document.id, supersedesId: null, confirmedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!proposal) throw new ReviewError("There is no proposal to review for this document.");

    // 2. Confirm as-is, or record a correction.
    const changed = changedFields(fieldsFromRow(proposal), input.fields);
    let classificationId: string;

    if (changed.length === 0) {
      await tx.documentClassification.update({ where: { id: proposal.id }, data: { confirmedBy: input.actor, confirmedAt: now } });
      classificationId = proposal.id;
      await writeAudit(tx, {
        actor: input.actor,
        action: "classification.confirmed",
        entityType: "DocumentClassification",
        entityId: proposal.id,
      });
    } else {
      const llm = fieldsFromRow(proposal);
      const correction = await tx.documentClassification.create({
        data: {
          documentId: document.id,
          source: "HUMAN",
          ...toData(input.fields),
          supersedesId: proposal.id,
          createdBy: input.actor,
          confirmedBy: input.actor,
          confirmedAt: now,
        },
      });
      classificationId = correction.id;
      await writeAudit(tx, {
        actor: input.actor,
        action: "classification.corrected",
        entityType: "DocumentClassification",
        entityId: correction.id,
        oldValue: { supersedes: proposal.id, ...Object.fromEntries(changed.map((k) => [k, llm[k]])) },
        newValue: Object.fromEntries(changed.map((k) => [k, input.fields[k]])),
      });
      await writeAudit(tx, {
        actor: input.actor,
        action: "classification.confirmed",
        entityType: "DocumentClassification",
        entityId: correction.id,
      });
    }

    await writeAudit(tx, {
      actor: input.actor,
      action: "document.statusChanged",
      entityType: "Document",
      entityId: document.id,
      oldValue: { status: "PROPOSED" },
      newValue: { status: "CONFIRMED" },
    });

    // 3. Fulfil the chosen obligation (re-validated here, never trusted from the form).
    let fulfilmentId: string | null = null;
    let obligationCompleted = false;
    if (input.obligationId) {
      const obligation = await tx.obligation.findUnique({ where: { id: input.obligationId }, include: { obligationType: true } });
      if (!obligation || obligation.clientId !== document.clientId) {
        throw new ReviewError("That obligation does not belong to this document's client.");
      }
      if (!isLinkAllowed({ status: obligation.status, acceptedDocumentTypes: obligation.obligationType.acceptedDocumentTypes }, input.fields.documentType)) {
        throw new ReviewError(`${obligation.obligationType.name} cannot be fulfilled by this document type.`);
      }

      const fulfilment = await tx.obligationFulfilment.create({
        data: { obligationId: obligation.id, documentId: document.id, classificationId, createdBy: input.actor },
      });
      fulfilmentId = fulfilment.id;
      await writeAudit(tx, {
        actor: input.actor,
        action: "fulfilment.created",
        entityType: "ObligationFulfilment",
        entityId: fulfilment.id,
        newValue: { obligationId: obligation.id, documentId: document.id, classificationId },
      });

      // 4. Complete it when the rule is met, or when the reviewer closes the period.
      const type = obligation.obligationType;
      const count = await tx.obligationFulfilment.count({
        where: { obligationId: obligation.id, revokedAt: null, classification: { confirmedAt: { not: null } } },
      });
      if (!type.requiresManualCompletion && count >= type.minDocuments) {
        obligationCompleted = await completeObligation(tx, obligation.id, input.actor, now, "Minimum confirmed documents received");
      } else if (type.requiresManualCompletion && input.closePeriod) {
        if (count < type.minDocuments) throw new ReviewError(`${type.name} needs at least ${type.minDocuments} document(s) before it can be closed.`);
        obligationCompleted = await completeObligation(tx, obligation.id, input.actor, now, "Period closed by reviewer: all documents received");
      }
    }

    return { outcome: changed.length === 0 ? "confirmed" : "corrected", classificationId, changed, fulfilmentId, obligationCompleted };
  });
}

/** Rejects an unusable or wrong document. It is kept (GoBD), just never counted. */
export async function rejectDocument(db: PrismaClient, input: { documentId: string; actor: string; reason: string }): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ReviewError("Give a short reason for rejecting the document.");
  await db.$transaction(async (tx) => {
    const moved = await tx.document.updateMany({ where: { id: input.documentId, status: "PROPOSED" }, data: { status: "REJECTED" } });
    if (moved.count !== 1) throw new ReviewError("This document is not awaiting review any more.");
    await writeAudit(tx, {
      actor: input.actor,
      action: "document.statusChanged",
      entityType: "Document",
      entityId: input.documentId,
      oldValue: { status: "PROPOSED" },
      newValue: { status: "REJECTED" },
      reason,
    });
  });
}
