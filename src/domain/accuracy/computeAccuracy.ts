// Classification accuracy: what the model proposed vs what a human confirmed.
//
// Pure and deterministic. Ground truth is the CONFIRMED classification of each
// reviewed document: the LLM row itself if the reviewer accepted it unchanged,
// or the HUMAN correction that supersedes it. Documents that were never
// reviewed, or were rejected, have no ground truth and are not counted here.
//
// "Correct" uses the same field comparison as the review step (changedFields),
// so a document counts as wrong here exactly when a reviewer corrected it.

import { changedFields, FIELD_NAMES, type ClassificationFields, type FieldName } from "../classificationFields";
import type { DocumentType } from "../obligations/types";

export interface ReviewedPair {
  documentId: string;
  filename: string;
  clientName: string;
  /** When the human confirmed it (ISO timestamp). */
  reviewedAt: string;
  modelUsed: string;
  /** The model's self-reported confidence, 0..1 (null if not given). */
  confidence: number | null;
  proposed: ClassificationFields;
  confirmed: ClassificationFields;
}

export interface Rate {
  correct: number;
  total: number;
  /** correct / total, or null when there is nothing to measure. */
  ratio: number | null;
}

export interface TypeAccuracy {
  /** The TRUE type (as confirmed by a human). */
  documentType: DocumentType;
  /** All fields right. */
  documents: Rate;
  /** Only the document type right. */
  typeIdentified: Rate;
  /** The field reviewers corrected most often for this type, if any. */
  mostCorrectedField: FieldName | null;
}

export interface ConfidenceBand {
  label: string;
  documents: Rate;
}

export interface Correction {
  documentId: string;
  filename: string;
  clientName: string;
  reviewedAt: string;
  changed: FieldName[];
  proposed: ClassificationFields;
  confirmed: ClassificationFields;
}

export interface AccuracyReport {
  /** All fields right, per document. */
  documents: Rate;
  fields: { field: FieldName; rate: Rate }[];
  byType: TypeAccuracy[];
  /** Where the model got the TYPE wrong: proposed → confirmed, with counts. */
  misclassifications: { proposed: DocumentType; confirmed: DocumentType; count: number }[];
  confidence: ConfidenceBand[];
  /** Most recent first. */
  corrections: Correction[];
}

const rate = (correct: number, total: number): Rate => ({ correct, total, ratio: total === 0 ? null : correct / total });

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Confidence bands. ASSUMPTION: 0.9 and 0.8 are useful cut-offs to show whether
 * the model's self-reported confidence means anything; adjust once there is data.
 */
const BANDS: { label: string; test: (c: number | null) => boolean }[] = [
  { label: "90 % or more", test: (c) => c !== null && c >= 0.9 },
  { label: "80 to 89 %", test: (c) => c !== null && c >= 0.8 && c < 0.9 },
  { label: "Below 80 %", test: (c) => c !== null && c < 0.8 },
  { label: "Not stated", test: (c) => c === null },
];

export function computeAccuracy(pairs: readonly ReviewedPair[]): AccuracyReport {
  const diffs = pairs.map((p) => ({ pair: p, changed: changedFields(p.proposed, p.confirmed) }));
  const isRight = (d: (typeof diffs)[number]) => d.changed.length === 0;

  // Fields
  const fields = FIELD_NAMES.map((field) => ({
    field,
    rate: rate(diffs.filter((d) => !d.changed.includes(field)).length, diffs.length),
  }));

  // By true document type
  const types = [...new Set(diffs.map((d) => d.pair.confirmed.documentType))];
  const byType: TypeAccuracy[] = types
    .map((documentType) => {
      const group = diffs.filter((d) => d.pair.confirmed.documentType === documentType);
      const counts = new Map<FieldName, number>();
      for (const d of group) for (const f of d.changed) counts.set(f, (counts.get(f) ?? 0) + 1);
      const most = [...counts.entries()].sort((a, b) => b[1] - a[1] || FIELD_NAMES.indexOf(a[0]) - FIELD_NAMES.indexOf(b[0]))[0];
      return {
        documentType,
        documents: rate(group.filter(isRight).length, group.length),
        typeIdentified: rate(group.filter((d) => !d.changed.includes("documentType")).length, group.length),
        mostCorrectedField: most ? most[0] : null,
      };
    })
    .sort((a, b) => b.documents.total - a.documents.total || cmp(a.documentType, b.documentType));

  // Type confusions
  const confusion = new Map<string, number>();
  for (const d of diffs) {
    if (d.pair.proposed.documentType === d.pair.confirmed.documentType) continue;
    const key = `${d.pair.proposed.documentType}>${d.pair.confirmed.documentType}`;
    confusion.set(key, (confusion.get(key) ?? 0) + 1);
  }
  const misclassifications = [...confusion.entries()]
    .map(([key, count]) => {
      const [proposed, confirmed] = key.split(">") as [DocumentType, DocumentType];
      return { proposed, confirmed, count };
    })
    .sort((a, b) => b.count - a.count || cmp(a.proposed, b.proposed) || cmp(a.confirmed, b.confirmed));

  // Is the model's confidence meaningful?
  const confidence = BANDS.map((band) => {
    const group = diffs.filter((d) => band.test(d.pair.confidence));
    return { label: band.label, documents: rate(group.filter(isRight).length, group.length) };
  });

  const corrections = diffs
    .filter((d) => !isRight(d))
    .sort((a, b) => cmp(b.pair.reviewedAt, a.pair.reviewedAt) || cmp(a.pair.documentId, b.pair.documentId))
    .map((d) => ({
      documentId: d.pair.documentId,
      filename: d.pair.filename,
      clientName: d.pair.clientName,
      reviewedAt: d.pair.reviewedAt,
      changed: d.changed,
      proposed: d.pair.proposed,
      confirmed: d.pair.confirmed,
    }));

  return {
    documents: rate(diffs.filter(isRight).length, diffs.length),
    fields,
    byType,
    misclassifications,
    confidence,
    corrections,
  };
}
