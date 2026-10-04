// Drafts an Eigenbeleg: validates it, renders the voucher PDF, stores it
// content-addressed, and creates a PROPOSED receipt document with a staff-
// entered (HUMAN, unconfirmed) classification — all in one audited transaction.
//
// It does NOT count towards anything yet: like every document it must be
// confirmed on the review page, which then links it to the obligation.

import type { PrismaClient } from "@/generated/prisma/client";
import { dbToIsoDate, isoDateToDb } from "@/domain/calendar/isoDate";
import { buildVoucher, checkEigenbeleg, voucherText, type EigenbelegCheck, type EigenbelegInput, type MissingReason } from "@/domain/eigenbeleg/eigenbeleg";
import { writeAudit } from "../audit";
import { germanDate } from "../clock";
import { sha256, storeOriginal } from "../documents/storage";
import { renderVoucherPdf } from "./renderVoucherPdf";

export class EigenbelegError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: EigenbelegCheck["errors"] = {},
  ) {
    super(message);
  }
}

export interface EigenbelegRequest {
  obligationId: string;
  expenseDate: string;
  payee: string;
  description: string;
  grossAmount: string;
  reason: MissingReason;
  reasonDetail: string;
  businessPurpose: string;
  digitallyConfirmedBy: string | null;
  actor: string;
}

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export async function createEigenbeleg(db: PrismaClient, request: EigenbelegRequest, now: Date = new Date()) {
  const obligation = await db.obligation.findUnique({ where: { id: request.obligationId }, include: { client: true, obligationType: true } });
  if (!obligation) throw new EigenbelegError("Choose the obligation this expense belongs to.");
  if (!obligation.obligationType.acceptedDocumentTypes.includes("RECEIPT") || obligation.obligationType.kind !== "CLIENT_DELIVERY") {
    throw new EigenbelegError(`An Eigenbeleg cannot fulfil ${obligation.obligationType.name}.`);
  }
  if (obligation.status === "WAIVED") throw new EigenbelegError("That obligation has been waived.");

  const start = dbToIsoDate(obligation.periodStart);
  const input: EigenbelegInput = {
    client: { name: obligation.client.name, clientNumber: obligation.client.clientNumber },
    period: { start, end: dbToIsoDate(obligation.periodEnd), label: `${obligation.obligationType.name} ${MONTHS_DE[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}` },
    expenseDate: request.expenseDate,
    payee: request.payee,
    description: request.description,
    grossAmount: request.grossAmount,
    reason: request.reason,
    reasonDetail: request.reasonDetail,
    businessPurpose: request.businessPurpose,
    digitallyConfirmedBy: request.digitallyConfirmedBy,
    createdBy: request.actor,
    createdOn: germanDate(now),
  };
  const check = checkEigenbeleg(input);
  if (Object.keys(check.errors).length > 0) throw new EigenbelegError("Some fields need fixing.", check.errors);

  return db.$transaction(async (tx) => {
    // Sequential voucher numbers per client (EB-<client>-0001, …).
    // LIMITATION: two drafts at the same instant could get the same number; fine for the prototype.
    const previous = await tx.document.count({ where: { clientId: obligation.clientId, origin: "EIGENBELEG" } });
    const number = `EB-${obligation.client.clientNumber}-${String(previous + 1).padStart(4, "0")}`;
    const voucher = buildVoucher(input, number);
    const bytes = await renderVoucherPdf(voucher, now);
    const hash = sha256(bytes);
    const storagePath = await storeOriginal(bytes, "application/pdf", hash);

    const document = await tx.document.create({
      data: {
        clientId: obligation.clientId,
        filename: `Eigenbeleg_${number}.pdf`,
        mimeType: "application/pdf",
        storagePath,
        sha256: hash,
        sizeBytes: bytes.byteLength,
        uploadedAt: now,
        uploadedBy: request.actor,
        rawText: voucherText(voucher),
        status: "PROPOSED",
        origin: "EIGENBELEG",
      },
    });
    const classification = await tx.documentClassification.create({
      data: {
        documentId: document.id,
        source: "HUMAN", // entered by staff, not proposed by the model — excluded from AI accuracy
        documentType: "RECEIPT",
        documentDate: isoDateToDb(input.expenseDate),
        amount: request.grossAmount,
        vatAmount: "0.00", // no input VAT without an invoice (§15 UStG)
        currency: "EUR",
        counterparty: input.payee.trim(),
        createdBy: request.actor,
      },
    });

    await writeAudit(tx, {
      actor: request.actor,
      action: "document.uploaded",
      entityType: "Document",
      entityId: document.id,
      newValue: { filename: document.filename, sha256: hash, sizeBytes: bytes.byteLength, origin: "EIGENBELEG" },
    });
    await writeAudit(tx, {
      actor: request.actor,
      action: "eigenbeleg.created",
      entityType: "Document",
      entityId: document.id,
      newValue: {
        voucherNumber: number,
        obligationId: obligation.id,
        expenseDate: input.expenseDate,
        payee: input.payee.trim(),
        grossAmount: request.grossAmount,
        reason: request.reason,
        reasonDetail: request.reasonDetail.trim(),
        businessPurpose: input.businessPurpose.trim(),
        digitallyConfirmedBy: input.digitallyConfirmedBy,
        warnings: check.warnings,
      },
    });
    await writeAudit(tx, {
      actor: request.actor,
      action: "classification.proposed",
      entityType: "DocumentClassification",
      entityId: classification.id,
      newValue: { documentId: document.id, documentType: "RECEIPT", source: "HUMAN", origin: "EIGENBELEG" },
    });

    return { documentId: document.id, voucherNumber: number, warnings: check.warnings };
  });
}
