"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentActor } from "@/server/currentUser";
import { parseReviewedFields, type FieldName } from "@/server/review/fields";
import { confirmDocument, rejectDocument, ReviewError } from "@/server/review/reviewDocument";

export type ReviewState = { status: "idle" } | { status: "error"; message: string; fieldErrors?: Partial<Record<FieldName, string>> };

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/upload");
}

export async function confirmAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const documentId = String(formData.get("documentId") ?? "");
  const parsed = parseReviewedFields(Object.fromEntries(formData));
  if (!parsed.ok) return { status: "error", message: "Some fields need fixing before you can save.", fieldErrors: parsed.errors };

  const obligationId = String(formData.get("obligationId") ?? "") || null;
  let outcome: string;
  try {
    const result = await confirmDocument(db, {
      documentId,
      actor: currentActor(),
      fields: parsed.fields,
      obligationId,
      closePeriod: formData.get("closePeriod") === "on",
    });
    outcome = result.outcome;
  } catch (error) {
    if (error instanceof ReviewError) return { status: "error", message: error.message };
    console.error("[confirmAction]", error);
    return { status: "error", message: "Saving the review failed. Check the server log for details." };
  }
  revalidateAll();
  redirect(`/review?done=${documentId}&outcome=${outcome}`);
}

export async function rejectAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const documentId = String(formData.get("documentId") ?? "");
  try {
    await rejectDocument(db, { documentId, actor: currentActor(), reason: String(formData.get("reason") ?? "") });
  } catch (error) {
    if (error instanceof ReviewError) return { status: "error", message: error.message };
    console.error("[rejectAction]", error);
    return { status: "error", message: "Rejecting the document failed. Check the server log for details." };
  }
  revalidateAll();
  redirect(`/review?done=${documentId}&outcome=rejected`);
}
