// Maps a validated LLM proposal onto DocumentClassification columns.

import type { DocumentProposal } from "@/ai/documentSchema";
import { isoDateToDb } from "@/domain/calendar/isoDate";

/** Money as an exact 2-decimal string for Postgres DECIMAL(12,2); never a float in the DB. */
export function toMoney(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

export function proposalToClassificationData(proposal: DocumentProposal) {
  return {
    documentType: proposal.documentType,
    documentDate: proposal.documentDate ? isoDateToDb(proposal.documentDate) : null,
    amount: toMoney(proposal.amount),
    vatAmount: toMoney(proposal.vatAmount),
    currency: proposal.currency,
    counterparty: proposal.counterparty,
    confidence: proposal.confidence,
  };
}
