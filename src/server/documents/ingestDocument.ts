// Upload pipeline: validate → store original → extract text → Document
// (PENDING) → LLM proposal → DocumentClassification (unconfirmed) and
// Document status PROPOSED. Every state change is audited.
//
// If the model call fails, the document stays PENDING (and is audited as
// such) so it can be retried; nothing about obligations changes either way.

import type { LanguageModel } from "ai";
import { classifyDocument } from "@/ai/classifyDocument";
import type { DocumentProposal } from "@/ai/documentSchema";
import { classificationModelId, getClassificationModel } from "@/ai/model";
import type { PrismaClient } from "@/generated/prisma/client";
import { writeAudit } from "../audit";
import { extractText } from "./extractText";
import { proposalToClassificationData } from "./proposalToDb";
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES, readOriginal, sha256, storeOriginal } from "./storage";

/** A problem with the upload itself; the message is safe to show to the user. */
export class UploadError extends Error {}

export type IngestResult =
  | { kind: "proposed"; documentId: string; proposal: DocumentProposal }
  | { kind: "duplicate"; documentId: string; uploadedAt: Date }
  | { kind: "classificationFailed"; documentId: string; error: string };

export interface UploadInput {
  clientId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  actor: string;
}

export async function ingestDocument(db: PrismaClient, input: UploadInput, model?: LanguageModel): Promise<IngestResult> {
  if (!ACCEPTED_MIME_TYPES.includes(input.mimeType)) {
    throw new UploadError("Only PDF, PNG, JPEG and WebP files can be uploaded.");
  }
  if (input.bytes.byteLength === 0) throw new UploadError("The file is empty.");
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError("The file is larger than 10 MB.");

  const client = await db.client.findFirst({ where: { id: input.clientId, isActive: true } });
  if (!client) throw new UploadError("Choose the client who sent this document.");

  // The same file from the same client is stored once.
  const hash = sha256(input.bytes);
  const existing = await db.document.findFirst({ where: { clientId: client.id, sha256: hash } });
  if (existing) return { kind: "duplicate", documentId: existing.id, uploadedAt: existing.uploadedAt };

  const storagePath = await storeOriginal(input.bytes, input.mimeType, hash);
  const extracted = await extractText(input.bytes, input.mimeType);

  const document = await db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        clientId: client.id,
        filename: input.filename,
        mimeType: input.mimeType,
        storagePath,
        sha256: hash,
        sizeBytes: input.bytes.byteLength,
        uploadedBy: input.actor,
        rawText: extracted.text,
        status: "PENDING",
      },
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "document.uploaded",
      entityType: "Document",
      entityId: doc.id,
      newValue: { filename: input.filename, sha256: hash, sizeBytes: input.bytes.byteLength, textSource: extracted.source },
    });
    return doc;
  });

  return classifyPendingDocument(db, document.id, input.actor, model);
}

/** Runs (or re-runs) the LLM on a PENDING document. Also used by the "Retry" button. */
export async function classifyPendingDocument(
  db: PrismaClient,
  documentId: string,
  actor: string,
  model?: LanguageModel,
): Promise<IngestResult> {
  const document = await db.document.findUniqueOrThrow({ where: { id: documentId }, include: { client: true } });
  if (document.status !== "PENDING") {
    throw new UploadError("This document has already been classified.");
  }

  const modelId = model ? (typeof model === "string" ? model : model.modelId) : classificationModelId();
  const llmActor = `llm:${modelId}`;

  let result;
  try {
    const bytes = await readOriginal(document.storagePath, document.sha256);
    result = await classifyDocument(
      {
        clientName: document.client.name,
        filename: document.filename,
        text: document.rawText,
        file: { data: bytes, mediaType: document.mimeType },
      },
      model ?? getClassificationModel(),
    );
  } catch (error) {
    const message = describeError(error);
    await writeAudit(db, {
      actor: llmActor,
      action: "classification.failed",
      entityType: "Document",
      entityId: document.id,
      newValue: { error: message },
    });
    return { kind: "classificationFailed", documentId: document.id, error: message };
  }

  await db.$transaction(async (tx) => {
    // Guard against two concurrent runs: only one may move PENDING → PROPOSED.
    const moved = await tx.document.updateMany({
      where: { id: document.id, status: "PENDING" },
      data: {
        status: "PROPOSED",
        // Images / scanned PDFs: keep the model's transcription as the searchable text.
        ...(document.rawText === null && result.transcribedText ? { rawText: result.transcribedText } : {}),
      },
    });
    if (moved.count !== 1) throw new UploadError("This document was classified by someone else in the meantime.");

    const classification = await tx.documentClassification.create({
      data: {
        documentId: document.id,
        source: "LLM",
        ...proposalToClassificationData(result.proposal),
        modelUsed: modelId,
        createdBy: llmActor,
      },
    });
    await writeAudit(tx, {
      actor: llmActor,
      action: "classification.proposed",
      entityType: "DocumentClassification",
      entityId: classification.id,
      newValue: { documentId: document.id, ...result.proposal },
    });
    await writeAudit(tx, {
      actor,
      action: "document.statusChanged",
      entityType: "Document",
      entityId: document.id,
      oldValue: { status: "PENDING" },
      newValue: {
        status: "PROPOSED",
        ...(document.rawText === null && result.transcribedText ? { textSource: "llm-transcription" } : {}),
      },
    });
  });

  return { kind: "proposed", documentId: document.id, proposal: result.proposal };
}

/** A short, user-readable reason; details stay in the server log. */
function describeError(error: unknown): string {
  console.error("[classifyDocument]", error);
  if (!(error instanceof Error)) return "Classification failed for an unknown reason.";
  if (error.message.includes("GOOGLE_GENERATIVE_AI_API_KEY")) return error.message;
  if (error.message.startsWith("Integrity check failed")) return error.message;
  switch (error.name) {
    case "AI_NoObjectGeneratedError":
    case "AI_NoOutputGeneratedError":
    case "AI_TypeValidationError":
    case "AI_JSONParseError":
      return "The model's answer did not match the required format, so it was not saved.";
    case "AI_APICallError":
      return `The Gemini API rejected the request: ${error.message}`;
    case "AI_RetryError":
      return `The Gemini API is unavailable or rate-limited: ${error.message}`;
    default:
      return `Classification failed: ${error.message}`;
  }
}
