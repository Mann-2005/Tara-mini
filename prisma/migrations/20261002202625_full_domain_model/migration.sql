/*
  Warnings:

  - Added the required column `federalState` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fiscalYearEndMonth` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `hasDauerfristverlaengerung` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `hasPayroll` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vatFilingFrequency` to the `Client` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "VatFilingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'NONE');

-- CreateEnum
CREATE TYPE "FederalState" AS ENUM ('BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH');

-- CreateEnum
CREATE TYPE "ObligationKind" AS ENUM ('CLIENT_DELIVERY', 'FIRM_FILING');

-- CreateEnum
CREATE TYPE "Applicability" AS ENUM ('ALWAYS', 'VAT_REGISTERED', 'HAS_PAYROLL');

-- CreateEnum
CREATE TYPE "Recurrence" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'FOLLOWS_VAT_FREQUENCY');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('OPEN', 'COMPLETE', 'WAIVED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROPOSED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INCOMING_INVOICE', 'OUTGOING_INVOICE', 'RECEIPT', 'BANK_STATEMENT', 'PAYROLL_DATA', 'ELSTER_RECEIPT', 'OTHER');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('LLM', 'HUMAN');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "federalState" "FederalState" NOT NULL,
ADD COLUMN     "fiscalYearEndMonth" INTEGER NOT NULL,
ADD COLUMN     "hasDauerfristverlaengerung" BOOLEAN NOT NULL,
ADD COLUMN     "hasPayroll" BOOLEAN NOT NULL,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "vatFilingFrequency" "VatFilingFrequency" NOT NULL;

-- CreateTable
CREATE TABLE "ObligationType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "ObligationKind" NOT NULL,
    "appliesWhen" "Applicability" NOT NULL,
    "recurrence" "Recurrence" NOT NULL,
    "dueMonthsAfterPeriodEnd" INTEGER NOT NULL,
    "dueDayOfMonth" INTEGER NOT NULL,
    "dauerfristExtensionMonths" INTEGER NOT NULL DEFAULT 0,
    "rollForwardToWorkingDay" BOOLEAN NOT NULL DEFAULT true,
    "acceptedDocumentTypes" "DocumentType"[],
    "minDocuments" INTEGER NOT NULL DEFAULT 1,
    "requiresManualCompletion" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObligationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "obligationTypeId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "ObligationStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,
    "rawText" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentClassification" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "source" "ClassificationSource" NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "documentDate" DATE,
    "amount" DECIMAL(12,2),
    "vatAmount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "counterparty" TEXT,
    "confidence" DOUBLE PRECISION,
    "modelUsed" TEXT,
    "supersedesId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObligationFulfilment" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "ObligationFulfilment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ObligationType_code_key" ON "ObligationType"("code");

-- CreateIndex
CREATE INDEX "Obligation_dueDate_status_idx" ON "Obligation"("dueDate", "status");

-- CreateIndex
CREATE INDEX "Obligation_clientId_status_idx" ON "Obligation"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Obligation_clientId_obligationTypeId_periodStart_key" ON "Obligation"("clientId", "obligationTypeId", "periodStart");

-- CreateIndex
CREATE INDEX "Document_clientId_status_idx" ON "Document"("clientId", "status");

-- CreateIndex
CREATE INDEX "Document_sha256_idx" ON "Document"("sha256");

-- CreateIndex
CREATE INDEX "DocumentClassification_documentId_idx" ON "DocumentClassification"("documentId");

-- CreateIndex
CREATE INDEX "DocumentClassification_source_documentType_idx" ON "DocumentClassification"("source", "documentType");

-- CreateIndex
CREATE INDEX "ObligationFulfilment_documentId_idx" ON "ObligationFulfilment"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ObligationFulfilment_obligationId_documentId_key" ON "ObligationFulfilment"("obligationId", "documentId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_obligationTypeId_fkey" FOREIGN KEY ("obligationTypeId") REFERENCES "ObligationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentClassification" ADD CONSTRAINT "DocumentClassification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentClassification" ADD CONSTRAINT "DocumentClassification_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "DocumentClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationFulfilment" ADD CONSTRAINT "ObligationFulfilment_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationFulfilment" ADD CONSTRAINT "ObligationFulfilment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationFulfilment" ADD CONSTRAINT "ObligationFulfilment_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "DocumentClassification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written below this line (not generated by Prisma).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Sanity constraints on rule data ────────────────────────────────────────
ALTER TABLE "Client"
  ADD CONSTRAINT "Client_fiscalYearEndMonth_check" CHECK ("fiscalYearEndMonth" BETWEEN 1 AND 12);

ALTER TABLE "ObligationType"
  ADD CONSTRAINT "ObligationType_dueDayOfMonth_check" CHECK ("dueDayOfMonth" BETWEEN 1 AND 31),
  ADD CONSTRAINT "ObligationType_dueMonthsAfterPeriodEnd_check" CHECK ("dueMonthsAfterPeriodEnd" >= 0),
  ADD CONSTRAINT "ObligationType_dauerfristExtensionMonths_check" CHECK ("dauerfristExtensionMonths" >= 0),
  ADD CONSTRAINT "ObligationType_minDocuments_check" CHECK ("minDocuments" >= 1);

ALTER TABLE "Obligation"
  ADD CONSTRAINT "Obligation_period_check" CHECK ("periodEnd" >= "periodStart");

ALTER TABLE "DocumentClassification"
  ADD CONSTRAINT "DocumentClassification_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1),
  -- Confirmation is all-or-nothing: who AND when.
  ADD CONSTRAINT "DocumentClassification_confirmation_check" CHECK (("confirmedBy" IS NULL) = ("confirmedAt" IS NULL));

-- ─── GoBD: no hard deletes ──────────────────────────────────────────────────
-- Accounting-relevant records must stay traceable and unalterable (GoBD).
-- Rows are deactivated/revoked/rejected via status fields instead.
-- Note: `prisma migrate reset` drops the whole schema, which these row/
-- statement triggers do not block — that is the intended dev reset path.
CREATE FUNCTION prevent_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'GoBD: % on "%" is not allowed; records are never deleted (use status/revocation fields)', TG_OP, TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Client','ObligationType','Obligation','Document','DocumentClassification','ObligationFulfilment','AuditEvent']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_delete()', t || '_no_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION prevent_delete()', t || '_no_truncate', t);
  END LOOP;
END;
$$;

-- ─── GoBD: audit log is append-only ─────────────────────────────────────────
CREATE FUNCTION prevent_audit_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'GoBD: AuditEvent is append-only; UPDATE is not allowed';
END;
$$;

CREATE TRIGGER "AuditEvent_no_update" BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_update();

-- ─── Classifications are immutable proposals ────────────────────────────────
-- The only permitted change is the one-time confirmation (confirmedBy/At go
-- from NULL to a value). Corrections are new HUMAN rows, never edits.
CREATE FUNCTION protect_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."confirmedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'GoBD: confirmed classification % cannot be changed', OLD.id;
  END IF;
  IF (to_jsonb(NEW) - 'confirmedBy' - 'confirmedAt') <> (to_jsonb(OLD) - 'confirmedBy' - 'confirmedAt') THEN
    RAISE EXCEPTION 'GoBD: classification % is immutable; insert a HUMAN correction row instead', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DocumentClassification_immutable" BEFORE UPDATE ON "DocumentClassification"
  FOR EACH ROW EXECUTE FUNCTION protect_classification();
