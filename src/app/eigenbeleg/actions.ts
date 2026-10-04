"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MISSING_REASONS, type EigenbelegField, type MissingReason } from "@/domain/eigenbeleg/eigenbeleg";
import { parseMoney } from "@/domain/money";
import { db } from "@/lib/db";
import { currentActor } from "@/server/currentUser";
import { createEigenbeleg, EigenbelegError } from "@/server/eigenbeleg/createEigenbeleg";

export type EigenbelegFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Partial<Record<EigenbelegField | "obligationId" | "noVat", string>> };

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

export async function createEigenbelegAction(_prev: EigenbelegFormState, formData: FormData): Promise<EigenbelegFormState> {
  const obligationId = text(formData, "obligationId");
  const fieldErrors: Extract<EigenbelegFormState, { status: "error" }>["fieldErrors"] = {};

  if (!obligationId) fieldErrors.obligationId = "Choose what this expense counts towards.";
  if (formData.get("noVat") !== "on") fieldErrors.noVat = "An Eigenbeleg can only be booked without input VAT.";
  const amount = parseMoney(text(formData, "grossAmount"));
  if (!amount) fieldErrors.grossAmount = "Enter the amount paid, e.g. 47,60.";
  const reason = text(formData, "reason");
  if (!(reason in MISSING_REASONS)) fieldErrors.reason = "Choose why the original receipt is missing.";
  const confirmedDigitally = formData.get("signature") === "digital";
  if (Object.keys(fieldErrors).length > 0) return { status: "error", message: "Some fields need fixing.", fieldErrors };

  let created;
  try {
    created = await createEigenbeleg(db, {
      obligationId,
      expenseDate: text(formData, "expenseDate"),
      payee: text(formData, "payee"),
      description: text(formData, "description"),
      grossAmount: amount!,
      reason: reason as MissingReason,
      reasonDetail: text(formData, "reasonDetail"),
      businessPurpose: text(formData, "businessPurpose"),
      digitallyConfirmedBy: confirmedDigitally ? text(formData, "confirmedBy") : null,
      actor: currentActor(),
    });
  } catch (error) {
    if (error instanceof EigenbelegError) return { status: "error", message: error.message, fieldErrors: error.fieldErrors };
    console.error("[createEigenbelegAction]", error);
    return { status: "error", message: "The Eigenbeleg could not be created. Check the server log for details.", fieldErrors: {} };
  }

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/upload");
  redirect(`/review/${created.documentId}?drafted=${encodeURIComponent(created.voucherNumber)}${created.warnings.length ? "&largeAmount=1" : ""}`);
}
