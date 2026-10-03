// Gathers reviewed documents as (LLM proposal, confirmed truth) pairs.

import type { PrismaClient } from "@/generated/prisma/client";
import type { ReviewedPair } from "@/domain/accuracy/computeAccuracy";
import { fieldsFromRow } from "../review/fields";

/** The model id the seed uses for its scripted, simulated proposals. */
export const SEED_MODEL = "seed-fixture";

export async function loadReviewedPairs(db: PrismaClient): Promise<ReviewedPair[]> {
  const documents = await db.document.findMany({
    where: { status: "CONFIRMED" },
    include: { client: { select: { name: true } }, classifications: true },
  });

  const pairs: ReviewedPair[] = [];
  for (const d of documents) {
    const confirmed = d.classifications.find((c) => c.confirmedAt !== null);
    if (!confirmed?.confirmedAt) continue;
    // The proposal is the confirmed row itself (accepted as-is) or the LLM row it supersedes.
    const proposal = confirmed.source === "LLM" ? confirmed : d.classifications.find((c) => c.id === confirmed.supersedesId);
    if (!proposal || proposal.source !== "LLM") continue; // no model proposal to measure

    pairs.push({
      documentId: d.id,
      filename: d.filename,
      clientName: d.client.name,
      reviewedAt: confirmed.confirmedAt.toISOString(),
      modelUsed: proposal.modelUsed ?? "unknown",
      confidence: proposal.confidence,
      proposed: fieldsFromRow(proposal),
      confirmed: fieldsFromRow(confirmed),
    });
  }
  return pairs;
}

/** Counts that explain what is NOT in the accuracy figures. */
export async function loadUnmeasuredCounts(db: PrismaClient) {
  const [awaitingReview, rejected, notClassified] = await Promise.all([
    db.document.count({ where: { status: "PROPOSED" } }),
    db.document.count({ where: { status: "REJECTED" } }),
    db.document.count({ where: { status: "PENDING" } }),
  ]);
  return { awaitingReview, rejected, notClassified };
}
