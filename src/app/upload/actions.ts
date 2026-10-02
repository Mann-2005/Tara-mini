"use server";

import { revalidatePath } from "next/cache";
import type { DocumentProposal } from "@/ai/documentSchema";
import { db } from "@/lib/db";
import { currentActor } from "@/server/currentUser";
import { classifyPendingDocument, ingestDocument, UploadError, type IngestResult } from "@/server/documents/ingestDocument";

export type UploadState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "proposed"; documentId: string; filename: string; proposal: DocumentProposal }
  | { status: "duplicate"; documentId: string; filename: string; uploadedAt: string }
  | { status: "failed"; documentId: string; filename: string; message: string };

function toState(result: IngestResult, filename: string): UploadState {
  switch (result.kind) {
    case "proposed":
      return { status: "proposed", documentId: result.documentId, filename, proposal: result.proposal };
    case "duplicate":
      return { status: "duplicate", documentId: result.documentId, filename, uploadedAt: result.uploadedAt.toISOString() };
    case "classificationFailed":
      return { status: "failed", documentId: result.documentId, filename, message: result.error };
  }
}

export async function uploadDocument(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const clientId = String(formData.get("clientId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a file to upload." };

  try {
    const result = await ingestDocument(db, {
      clientId,
      filename: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      actor: currentActor(),
    });
    return toState(result, file.name);
  } catch (error) {
    if (error instanceof UploadError) return { status: "error", message: error.message };
    console.error("[uploadDocument]", error);
    return { status: "error", message: "The upload failed. Check the server log for details." };
  } finally {
    revalidatePath("/upload");
    revalidatePath("/");
  }
}

/** Re-runs classification for a document that is still PENDING. */
export async function retryClassification(formData: FormData): Promise<void> {
  const documentId = String(formData.get("documentId") ?? "");
  try {
    await classifyPendingDocument(db, documentId, currentActor());
  } catch (error) {
    if (!(error instanceof UploadError)) console.error("[retryClassification]", error);
  }
  revalidatePath("/upload");
}
