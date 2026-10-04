// Seed data for Tara Mini.
//
//   pnpm db:seed                       # as of 2026-10-02 (default)
//   SEED_AS_OF=2026-11-15 pnpm db:seed # other reference date
//
// Window: the 6 months before the anchor date. Apr–Jun 2026 are generated,
// fully completed history (for the V2 Compliance Score); Jul–Sep 2026 are the
// scripted live story shown on the dashboard, plus the V2 scenarios (Weber's
// missing O2 invoice, outgoing invoices for the VAT forecast).
//
// Idempotent: re-running creates nothing new. To start from scratch use
// `pnpm db:reset` (drops the schema; DELETE is blocked by GoBD triggers).
//
// Everything written here is attributed to actor "system:seed" in the audit
// log, and LLM rows use modelUsed "seed-fixture" — seeded data never
// pretends to come from a real person or a real model call.

import "dotenv/config";
import { createHash } from "node:crypto";
import type { DocumentType, Prisma } from "../src/generated/prisma/client";
import { db } from "../src/lib/db";
import { addDays, daysInMonth, dbToIsoDate, isoDateToDb, parseIsoMonth, toIsoDate, type IsoDate, type IsoMonth } from "../src/domain/calendar/isoDate";
import { lastFullMonths } from "../src/domain/obligations/generate";
import { STANDARD_OBLIGATION_TYPES } from "../src/domain/obligations/standardTypes";
import { writeAudit } from "../src/server/audit";
import { completeObligation } from "../src/server/obligations/completeObligation";
import { syncObligations } from "../src/server/obligations/syncObligations";

const ACTOR = "system:seed";
const SEED_MODEL = "seed-fixture";
const AS_OF: IsoDate = process.env.SEED_AS_OF ?? "2026-10-02";


// ─── Clients ────────────────────────────────────────────────────────────────

const CLIENTS: Prisma.ClientCreateInput[] = [
  {
    clientNumber: "10001",
    name: "Bäckerei Müller GmbH",
    fiscalYearEndMonth: 12,
    vatFilingFrequency: "MONTHLY",
    hasPayroll: true,
    hasDauerfristverlaengerung: false,
    federalState: "BY",
  },
  {
    clientNumber: "10002",
    name: "Schmidt IT-Beratung",
    fiscalYearEndMonth: 12,
    vatFilingFrequency: "QUARTERLY",
    hasPayroll: false,
    hasDauerfristverlaengerung: false,
    federalState: "BE",
  },
  {
    clientNumber: "10003",
    name: "Weber Bau GmbH",
    fiscalYearEndMonth: 12,
    vatFilingFrequency: "MONTHLY",
    hasPayroll: true,
    hasDauerfristverlaengerung: true,
    federalState: "NW",
  },
  {
    // Physiotherapy is VAT-exempt (§4 Nr. 14 UStG) → no UStVA at all.
    clientNumber: "10004",
    name: "Physiotherapie Fischer",
    fiscalYearEndMonth: 12,
    vatFilingFrequency: "NONE",
    hasPayroll: true,
    hasDauerfristverlaengerung: false,
    federalState: "HH",
  },
  {
    // Non-calendar fiscal year (ends June). UStVA still follows calendar quarters.
    clientNumber: "10005",
    name: "Becker Online-Handel UG (haftungsbeschränkt)",
    fiscalYearEndMonth: 6,
    vatFilingFrequency: "QUARTERLY",
    hasPayroll: false,
    hasDauerfristverlaengerung: true,
    federalState: "BW",
  },
];

// ─── Delivery history ───────────────────────────────────────────────────────
// What each client has sent so far, chosen so the dashboard shows a mix:
//   10001 Müller   – fully up to date (green)
//   10002 Schmidt  – Sept bank statement only uploaded, not yet reviewed; Sept invoices open (amber)
//   10003 Weber    – Aug + Sept payroll data overdue (red)
//   10004 Fischer  – Aug invoices received but not closed past the deadline; Sept missing
//   10005 Becker   – Jul/Aug delivered, Sept not yet due (green)

type Outcome = "CONFIRMED" | "CORRECTED" | "PROPOSED" | "REJECTED";

interface Fields {
  documentType: DocumentType;
  documentDate: IsoDate;
  amount?: string;
  vatAmount?: string;
  counterparty?: string;
}

interface SeedDoc {
  client: string;
  /** Obligation to fulfil: type code + month in which its period ENDS. */
  fulfils?: { type: string; periodEndMonth: IsoMonth };
  filename: string;
  mimeType: string;
  rawText: string;
  /** The true values (what a human confirms). */
  truth: Fields;
  outcome: Outcome;
  /** For CORRECTED: the fields the LLM got wrong. */
  llmMistakes?: Partial<Fields>;
  confidence: number;
  /** When the client delivered it. */
  uploadedOn: IsoDate;
  rejectReason?: string;
}

const lastDay = (m: IsoMonth) => {
  const { year, month } = parseIsoMonth(m);
  return toIsoDate(year, month, daysInMonth(year, month));
};

function bankStatement(client: string, bank: string, m: IsoMonth, uploadedOn: IsoDate, outcome: Outcome = "CONFIRMED"): SeedDoc {
  return {
    client,
    fulfils: { type: "KONTOAUSZUEGE", periodEndMonth: m },
    filename: `Kontoauszug_${m}.pdf`,
    mimeType: "application/pdf",
    rawText: `${bank}\nKontoauszug Nr. ${m.slice(5)}/${m.slice(0, 4)}\nZeitraum: 01.${m.slice(5)}.${m.slice(0, 4)} – ${lastDay(m).slice(8)}.${m.slice(5)}.${m.slice(0, 4)}\nAlter Kontostand … Neuer Kontostand …`,
    truth: { documentType: "BANK_STATEMENT", documentDate: lastDay(m), counterparty: bank },
    outcome,
    confidence: 0.97,
    uploadedOn,
  };
}

function invoice(
  client: string,
  m: IsoMonth,
  n: number,
  vendor: string,
  gross: string,
  vat: string,
  uploadedOn: IsoDate,
  outcome: Outcome = "CONFIRMED",
  llmMistakes?: Partial<Fields>,
): SeedDoc {
  const date = `${m}-${String(3 + n * 7).padStart(2, "0")}`;
  return {
    client,
    fulfils: { type: "EINGANGSRECHNUNGEN", periodEndMonth: m },
    filename: `Rechnung_${vendor.split(" ")[0]}_${m}_${n}.pdf`,
    mimeType: "application/pdf",
    rawText: `${vendor}\nRechnung Nr. R-${m.replace("-", "")}-${n}\nRechnungsdatum: ${date}\nGesamtbetrag brutto: ${gross} EUR\nenthaltene USt 19 %: ${vat} EUR`,
    truth: { documentType: "INCOMING_INVOICE", documentDate: date, amount: gross, vatAmount: vat, counterparty: vendor },
    outcome,
    llmMistakes,
    confidence: llmMistakes ? 0.62 : 0.93,
    uploadedOn,
  };
}

function payroll(client: string, m: IsoMonth, uploadedOn: IsoDate): SeedDoc {
  return {
    client,
    fulfils: { type: "LOHN", periodEndMonth: m },
    filename: `Lohndaten_${m}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    rawText: `Lohndaten ${m}\nMitarbeiter | Stunden | Urlaub | Krank\n…`,
    truth: { documentType: "PAYROLL_DATA", documentDate: `${m}-10` },
    outcome: "CONFIRMED",
    confidence: 0.9,
    uploadedOn,
  };
}

function elster(client: string, periodEndMonth: IsoMonth, label: string, vat: string, uploadedOn: IsoDate): SeedDoc {
  return {
    client,
    fulfils: { type: "USTVA", periodEndMonth },
    filename: `ELSTER_UStVA_${label}.pdf`,
    mimeType: "application/pdf",
    rawText: `ELSTER Übermittlungsprotokoll\nUmsatzsteuer-Voranmeldung ${label}\nTransferticket: et${periodEndMonth.replace("-", "")}${client}\nVerbleibende Umsatzsteuer-Vorauszahlung: ${vat} EUR`,
    truth: { documentType: "ELSTER_RECEIPT", documentDate: uploadedOn, vatAmount: vat, counterparty: "Finanzamt" },
    outcome: "CONFIRMED",
    confidence: 0.99,
    uploadedOn,
  };
}

/** Weber's recurring phone bill: the V2 "ghost invoice" scenario (Jun–Aug arrive, September never does). */
const TELEFONICA = "Telefónica Germany GmbH & Co. OHG";
function telefonica(m: IsoMonth, uploadedOn: IsoDate): SeedDoc {
  return {
    client: "10003",
    fulfils: { type: "EINGANGSRECHNUNGEN", periodEndMonth: m },
    filename: `Rechnung_O2_${m}.pdf`,
    mimeType: "application/pdf",
    rawText: `${TELEFONICA}\nO2 Business Mobilfunk – Rechnung ${m.slice(5)}/${m.slice(0, 4)}\nRechnungsdatum: ${m}-03\nGesamtbetrag: 47,60 EUR\nenthaltene USt 19 %: 7,60 EUR`,
    truth: { documentType: "INCOMING_INVOICE", documentDate: `${m}-03`, amount: "47.60", vatAmount: "7.60", counterparty: TELEFONICA },
    outcome: "CONFIRMED",
    confidence: 0.96,
    uploadedOn,
  };
}

/** An invoice the client issued (Ausgangsrechnung): output VAT for the V2 VAT forecast. Not an obligation. */
function sale(client: string, date: IsoDate, customer: string, gross: string, vat: string, rate: string, uploadedOn: IsoDate): SeedDoc {
  return {
    client,
    filename: `Ausgangsrechnung_${date}_${customer.split(" ")[0]}.pdf`,
    mimeType: "application/pdf",
    rawText: `Rechnung an ${customer}\nRechnungsdatum: ${date}\nGesamtbetrag brutto: ${gross} EUR\nenthaltene USt ${rate} %: ${vat} EUR`,
    truth: { documentType: "OUTGOING_INVOICE", documentDate: date, amount: gross, vatAmount: vat, counterparty: customer },
    outcome: "CONFIRMED",
    confidence: 0.95,
    uploadedOn,
  };
}

const SEED_DOCS: SeedDoc[] = [
  // 10001 Bäckerei Müller — everything delivered on time; Jul + Aug UStVA filed.
  ...(["2026-07", "2026-08", "2026-09"] as const).flatMap((m, i) => [
    bankStatement("10001", "Sparkasse München", m, ["2026-08-03", "2026-09-02", "2026-10-01"][i]),
    invoice("10001", m, 1, "Mühle Huber KG", "1428.00", "228.00", ["2026-08-03", "2026-09-02", "2026-10-01"][i]),
    invoice("10001", m, 2, "Stadtwerke München", "595.00", "95.00", ["2026-08-03", "2026-09-02", "2026-10-01"][i]),
    payroll("10001", m, `${m}-12`),
  ]),
  elster("10001", "2026-07", "07/2026", "2140.55", "2026-08-07"),
  elster("10001", "2026-08", "08/2026", "1987.10", "2026-09-09"),

  // 10002 Schmidt IT-Beratung — Jul/Aug complete; Sept statement uploaded but only PROPOSED
  // (so it still counts as missing); one Sept invoice received, period not closed.
  bankStatement("10002", "Berliner Volksbank", "2026-07", "2026-08-04"),
  invoice("10002", "2026-07", 1, "Hetzner Online GmbH", "238.00", "38.00", "2026-08-04"),
  bankStatement("10002", "Berliner Volksbank", "2026-08", "2026-09-04"),
  invoice("10002", "2026-08", 1, "Hetzner Online GmbH", "238.00", "38.00", "2026-09-04"),
  bankStatement("10002", "Berliner Volksbank", "2026-09", "2026-10-01", "PROPOSED"),
  invoice("10002", "2026-09", 1, "Hetzner Online GmbH", "238.00", "38.00", "2026-10-01"),

  // 10003 Weber Bau — July fine (one invoice misclassified by the "LLM" and corrected);
  // August/September payroll data never arrived; one unusable photo rejected.
  bankStatement("10003", "Commerzbank", "2026-07", "2026-09-01"),
  invoice("10003", "2026-07", 1, "Baustoffhandel Krämer GmbH", "8925.00", "1425.00", "2026-09-01", "CORRECTED", {
    documentType: "RECEIPT",
    amount: "7500.00", // LLM took the net amount instead of gross
  }),
  payroll("10003", "2026-07", "2026-07-14"),
  elster("10003", "2026-07", "07/2026", "6310.00", "2026-09-08"),
  {
    client: "10003",
    filename: "IMG_4711.jpg",
    mimeType: "image/jpeg",
    rawText: "",
    truth: { documentType: "OTHER", documentDate: "2026-09-20" },
    outcome: "REJECTED",
    confidence: 0.21,
    uploadedOn: "2026-09-21",
    rejectReason: "Photo unreadable (blurred); client asked to resend",
  },

  // 10004 Physiotherapie Fischer — payroll always on time; August invoices arrived
  // but the period was never closed; nothing for September yet.
  ...(["2026-07", "2026-08", "2026-09"] as const).map((m) => payroll("10004", m, `${m}-11`)),
  bankStatement("10004", "Hamburger Sparkasse", "2026-07", "2026-08-05"),
  invoice("10004", "2026-07", 1, "Physio-Bedarf Nord GmbH", "357.00", "57.00", "2026-08-05"),
  bankStatement("10004", "Hamburger Sparkasse", "2026-08", "2026-09-03"),
  invoice("10004", "2026-08", 1, "Physio-Bedarf Nord GmbH", "214.20", "34.20", "2026-09-03"),
  invoice("10004", "2026-08", 2, "Hansa Immobilien GmbH", "1800.00", "0.00", "2026-09-03", "CORRECTED", {
    counterparty: "Physiotherapie Fischer", // LLM picked the recipient instead of the issuer
  }),

  // 10005 Becker Online-Handel — Jul/Aug delivered; Sept not yet due (Dauerfrist → 5 Nov).
  bankStatement("10005", "Volksbank Stuttgart", "2026-07", "2026-08-20"),
  invoice("10005", "2026-07", 1, "DHL Paket GmbH", "1190.00", "190.00", "2026-08-20"),
  bankStatement("10005", "Volksbank Stuttgart", "2026-08", "2026-09-25"),
  invoice("10005", "2026-08", 1, "DHL Paket GmbH", "1309.00", "209.00", "2026-09-25"),

  // ── V2 scenarios ──────────────────────────────────────────────────────────
  // Ghost invoice: Weber's O2 bill arrived for Jul and Aug (Jun is generated with the
  // history months); September's is missing → "Missing expected recurring invoice".
  telefonica("2026-07", "2026-09-01"),
  telefonica("2026-08", "2026-09-04"),

  // VAT forecast (next return to file as of 2 Oct 2026):
  //   Müller  Sep: output 1.050,00 (bakery goods, 7 %) − input 323,00 → Zahllast 727,00
  //   Weber   Aug: output 3.800,00 − input 7,60 (O2)                   → Zahllast 3.792,40
  //   Schmidt Q3:  output 5.700,00 − input 114,00 (Hetzner ×3)          → Zahllast 5.586,00
  //   Becker  Q3:  output 665,00 − input 1.349,00 (stock purchase)      → Guthaben 684,00
  sale("10001", "2026-09-15", "Hotel Bayerischer Hof", "10700.00", "700.00", "7", "2026-10-01"),
  sale("10001", "2026-09-25", "Café Luitpold", "5350.00", "350.00", "7", "2026-10-01"),
  sale("10003", "2026-08-20", "Bauherr Meyer", "23800.00", "3800.00", "19", "2026-09-04"),
  sale("10002", "2026-07-31", "Kanzlei Roth & Partner", "11900.00", "1900.00", "19", "2026-08-04"),
  sale("10002", "2026-08-31", "Kanzlei Roth & Partner", "11900.00", "1900.00", "19", "2026-09-04"),
  sale("10002", "2026-09-30", "Kanzlei Roth & Partner", "11900.00", "1900.00", "19", "2026-10-01"),
  sale("10005", "2026-07-31", "Shop-Kunden Juli (Sammelrechnung)", "2380.00", "380.00", "19", "2026-08-20"),
  sale("10005", "2026-08-31", "Shop-Kunden August (Sammelrechnung)", "1785.00", "285.00", "19", "2026-09-25"),
  invoice("10005", "2026-08", 2, "Großhandel Lindner GmbH", "5950.00", "950.00", "2026-09-25"),
];

// ─── History months (Apr–Jun 2026) for the V2 Compliance Score ─────────────
// Generated: every obligation in these months is delivered and completed, so the
// dashboard's current story is unchanged, but each client gets a delivery record.
// Invoices come from one-off suppliers (one per month), so the only RECURRING
// vendors are the deliberate ones above.

const HISTORY_MONTHS: IsoMonth[] = ["2026-04", "2026-05", "2026-06"];

/** Days late (negative = early) for client deliveries, cycled per obligation. Drives the grade. */
const LATENESS: Record<string, number[]> = {
  "10001": [-3, -2, -4], // Müller: always early → A
  "10002": [2, 4, 3], //    Schmidt: a few days late → B
  "10003": [18, 25, 30], // Weber: chronic backlog → D
  "10004": [10, 12, 14], // Fischer: one to two weeks → C
  "10005": [0, 1, -1], //   Becker: on time → A
};

const PROFILES: Record<string, { bank: string; suppliers: [string, string, string]; gross: string; vat: string }> = {
  "10001": { bank: "Sparkasse München", suppliers: ["Bäckereitechnik Wagner", "Verpackung Pfister", "Kältetechnik Obermaier"], gross: "952.00", vat: "152.00" },
  "10002": { bank: "Berliner Volksbank", suppliers: ["Cyberport GmbH", "Coworking Kreuzberg", "Fachbuch Hansen"], gross: "476.00", vat: "76.00" },
  "10003": { bank: "Commerzbank", suppliers: ["Würth Handelsges. mbH", "Hornbach Baumarkt AG", "Gerüstbau Schulte"], gross: "4165.00", vat: "665.00" },
  "10004": { bank: "Hamburger Sparkasse", suppliers: ["Medizintechnik Brandt", "Wäscherei Elbe", "Praxis-Software Nord"], gross: "297.50", vat: "47.50" },
  "10005": { bank: "Volksbank Stuttgart", suppliers: ["Kartonagen Huber", "Etikettendruck Maier", "Lagertechnik Roth"], gross: "714.00", vat: "114.00" },
};

async function historyDocs(clientIds: Map<string, string>): Promise<{ docs: SeedDoc[]; closes: typeof CLOSED_PERIODS }> {
  const docs: SeedDoc[] = [];
  const closes: typeof CLOSED_PERIODS = [];
  for (const [num, clientId] of [...clientIds].sort()) {
    const profile = PROFILES[num];
    const obligations = await db.obligation.findMany({
      where: { clientId, periodEnd: { in: HISTORY_MONTHS.map((m) => isoDateToDb(lastDay(m))) } },
      include: { obligationType: true },
      orderBy: [{ dueDate: "asc" }, { obligationType: { code: "asc" } }],
    });
    let i = 0;
    for (const o of obligations) {
      const m = dbToIsoDate(o.periodEnd).slice(0, 7);
      const due = dbToIsoDate(o.dueDate);
      const code = o.obligationType.code;
      if (code === "USTVA") {
        const quarterly = dbToIsoDate(o.periodStart).slice(0, 7) !== m;
        const label = quarterly ? `Q${Number(m.slice(5)) / 3}/${m.slice(0, 4)}` : `${m.slice(5)}/${m.slice(0, 4)}`;
        docs.push(elster(num, m, label, "1850.00", addDays(due, -2))); // the firm files on time
        continue;
      }
      const uploadedOn = addDays(due, LATENESS[num][i++ % 3]);
      if (code === "LOHN") docs.push(payroll(num, m, uploadedOn));
      if (code === "KONTOAUSZUEGE") docs.push(bankStatement(num, profile.bank, m, uploadedOn));
      if (code === "EINGANGSRECHNUNGEN") {
        docs.push(invoice(num, m, 1, profile.suppliers[HISTORY_MONTHS.indexOf(m)], profile.gross, profile.vat, uploadedOn));
        if (num === "10003" && m === "2026-06") docs.push(telefonica(m, uploadedOn)); // O2 already recurring in June
        closes.push({ client: num, type: "EINGANGSRECHNUNGEN", periodEndMonth: m });
      }
    }
  }
  return { docs, closes };
}

/** Periods (multi-document obligations) that staff has explicitly closed. */
const CLOSED_PERIODS: { client: string; type: string; periodEndMonth: IsoMonth }[] = [
  { client: "10001", type: "EINGANGSRECHNUNGEN", periodEndMonth: "2026-07" },
  { client: "10001", type: "EINGANGSRECHNUNGEN", periodEndMonth: "2026-08" },
  { client: "10001", type: "EINGANGSRECHNUNGEN", periodEndMonth: "2026-09" },
  { client: "10002", type: "EINGANGSRECHNUNGEN", periodEndMonth: "2026-07" },
  { client: "10002", type: "EINGANGSRECHNUNGEN", periodEndMonth: "2026-08" },
  { client: "10003", type: "EINGANGSRECHNUNGEN", periodEndMonth: "2026-07" },
  { client: "10004", type: "EINGANGSRECHNUNGEN", periodEndMonth: "2026-07" },
  { client: "10005", type: "EINGANGSRECHNUNGEN", periodEndMonth: "2026-07" },
  { client: "10005", type: "EINGANGSRECHNUNGEN", periodEndMonth: "2026-08" },
];

// ─── Seeding steps ──────────────────────────────────────────────────────────

const atNoon = (d: IsoDate) => new Date(`${d}T10:00:00.000Z`);

async function upsertObligationTypes() {
  for (const t of STANDARD_OBLIGATION_TYPES) {
    const existing = await db.obligationType.findUnique({ where: { code: t.code } });
    if (existing) continue; // rule changes after creation go through a migration/admin flow, not the seed
    await db.$transaction(async (tx) => {
      const created = await tx.obligationType.create({ data: t });
      await writeAudit(tx, { actor: ACTOR, action: "obligationType.created", entityType: "ObligationType", entityId: created.id, newValue: { code: t.code } });
    });
  }
}

async function upsertClients() {
  for (const c of CLIENTS) {
    const existing = await db.client.findUnique({ where: { clientNumber: c.clientNumber } });
    if (existing) continue;
    await db.$transaction(async (tx) => {
      const created = await tx.client.create({ data: c });
      await writeAudit(tx, { actor: ACTOR, action: "client.created", entityType: "Client", entityId: created.id, newValue: {
        clientNumber: created.clientNumber,
        name: created.name,
        fiscalYearEndMonth: created.fiscalYearEndMonth,
        vatFilingFrequency: created.vatFilingFrequency,
        hasPayroll: created.hasPayroll,
        hasDauerfristverlaengerung: created.hasDauerfristverlaengerung,
        federalState: created.federalState,
      } });
    });
  }
}

async function findObligation(clientId: string, typeCode: string, periodEndMonth: IsoMonth) {
  const obligation = await db.obligation.findFirst({
    where: { clientId, obligationType: { code: typeCode }, periodEnd: isoDateToDb(lastDay(periodEndMonth)) },
    include: { obligationType: true },
  });
  if (!obligation) throw new Error(`No ${typeCode} obligation ending ${periodEndMonth} for client ${clientId}`);
  return obligation;
}

function fieldsToData(f: Fields) {
  return {
    documentType: f.documentType,
    documentDate: isoDateToDb(f.documentDate),
    amount: f.amount ?? null,
    vatAmount: f.vatAmount ?? null,
    counterparty: f.counterparty ?? null,
  };
}

/** Replays one document's lifecycle: upload → LLM proposal → review → fulfilment. */
async function seedDocument(doc: SeedDoc, clientIds: Map<string, string>) {
  const clientId = clientIds.get(doc.client)!;
  const sha256 = createHash("sha256").update(`${doc.client}|${doc.filename}|${doc.rawText}`).digest("hex");
  if (await db.document.findFirst({ where: { clientId, sha256 } })) return false; // already seeded

  const obligation = doc.fulfils ? await findObligation(clientId, doc.fulfils.type, doc.fulfils.periodEndMonth) : null;
  const uploadedAt = atNoon(doc.uploadedOn);

  await db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        clientId,
        filename: doc.filename,
        mimeType: doc.mimeType,
        storagePath: `seed/${doc.client}/${doc.filename}`,
        sha256,
        sizeBytes: Buffer.byteLength(doc.rawText) + 2048,
        uploadedAt,
        uploadedBy: ACTOR,
        rawText: doc.rawText || null,
        status: "PROPOSED",
      },
    });
    await writeAudit(tx, { actor: ACTOR, action: "document.uploaded", entityType: "Document", entityId: document.id, newValue: { filename: doc.filename, sha256 } });

    // The (simulated) LLM proposal — includes its mistakes, if any.
    const proposal = await tx.documentClassification.create({
      data: {
        documentId: document.id,
        source: "LLM",
        ...fieldsToData({ ...doc.truth, ...doc.llmMistakes }),
        confidence: doc.confidence,
        modelUsed: SEED_MODEL,
        createdBy: `llm:${SEED_MODEL}`,
      },
    });
    await writeAudit(tx, { actor: `llm:${SEED_MODEL}`, action: "classification.proposed", entityType: "DocumentClassification", entityId: proposal.id, newValue: { documentId: document.id, documentType: proposal.documentType } });

    if (doc.outcome === "PROPOSED") return; // awaiting human review

    const setDocStatus = async (status: "CONFIRMED" | "REJECTED", reason?: string) => {
      await tx.document.update({ where: { id: document.id }, data: { status } });
      await writeAudit(tx, { actor: ACTOR, action: "document.statusChanged", entityType: "Document", entityId: document.id, oldValue: { status: "PROPOSED" }, newValue: { status }, reason });
    };

    if (doc.outcome === "REJECTED") {
      await setDocStatus("REJECTED", doc.rejectReason);
      return;
    }

    // Human review: confirm the proposal as-is, or add a corrected HUMAN row and confirm that.
    let confirmedId = proposal.id;
    if (doc.outcome === "CORRECTED") {
      const correction = await tx.documentClassification.create({
        data: { documentId: document.id, source: "HUMAN", ...fieldsToData(doc.truth), supersedesId: proposal.id, createdBy: ACTOR },
      });
      await writeAudit(tx, { actor: ACTOR, action: "classification.corrected", entityType: "DocumentClassification", entityId: correction.id, oldValue: { ...doc.llmMistakes }, newValue: { supersedes: proposal.id } });
      confirmedId = correction.id;
    }
    await tx.documentClassification.update({ where: { id: confirmedId }, data: { confirmedBy: ACTOR, confirmedAt: uploadedAt } });
    await writeAudit(tx, { actor: ACTOR, action: "classification.confirmed", entityType: "DocumentClassification", entityId: confirmedId });
    await setDocStatus("CONFIRMED");

    if (!obligation) return;
    const fulfilment = await tx.obligationFulfilment.create({
      data: { obligationId: obligation.id, documentId: document.id, classificationId: confirmedId, createdBy: ACTOR },
    });
    await writeAudit(tx, { actor: ACTOR, action: "fulfilment.created", entityType: "ObligationFulfilment", entityId: fulfilment.id, newValue: { obligationId: obligation.id, documentId: document.id } });

    // Auto-complete single-document obligations once enough documents are confirmed.
    const type = obligation.obligationType;
    const count = await tx.obligationFulfilment.count({ where: { obligationId: obligation.id, revokedAt: null } });
    if (!type.requiresManualCompletion && count >= type.minDocuments) {
      await completeObligation(tx, obligation.id, ACTOR, uploadedAt, "Minimum confirmed documents received");
    }
  });
  return true;
}

async function main() {
  // Six months: Apr–Jun are completed history (for the Compliance Score), Jul–Sep the live story.
  const [fromMonth, toMonth] = lastFullMonths(AS_OF, 6);
  console.log(`Seeding as of ${AS_OF}: obligation periods ending ${fromMonth} … ${toMonth}\n`);

  await upsertObligationTypes();
  await upsertClients();

  const rules = await db.obligationType.findMany();
  const clients = await db.client.findMany({ orderBy: { clientNumber: "asc" } });
  const clientIds = new Map(clients.map((c) => [c.clientNumber, c.id]));

  for (const client of clients) {
    const r = await syncObligations(db, client, rules, fromMonth, toMonth, ACTOR);
    console.log(`${client.clientNumber} ${client.name}: obligations +${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged`);
  }

  // The scripted documents are written for the default window (Apr–Sep 2026).
  if (fromMonth === "2026-04" && toMonth === "2026-09") {
    const history = await historyDocs(clientIds);
    const allDocs = [...history.docs, ...SEED_DOCS];
    let created = 0;
    for (const doc of allDocs) if (await seedDocument(doc, clientIds)) created++;
    console.log(`\nDocuments: +${created} created (${allDocs.length - created} already present)`);

    for (const p of [...history.closes, ...CLOSED_PERIODS]) {
      const obligation = await findObligation(clientIds.get(p.client)!, p.type, p.periodEndMonth);
      const lastUpload = await db.document.findFirst({
        where: { fulfilments: { some: { obligationId: obligation.id } } },
        orderBy: { uploadedAt: "desc" },
      });
      await db.$transaction((tx) => completeObligation(tx, obligation.id, ACTOR, lastUpload?.uploadedAt ?? new Date(), "Period closed by staff: all invoices received"));
    }
  } else {
    console.log("\n(Non-default SEED_AS_OF: scripted documents skipped; obligations only.)");
  }

  await printSummary();
}

async function printSummary() {
  const obligations = await db.obligation.findMany({
    include: { client: true, obligationType: true, _count: { select: { fulfilments: { where: { revokedAt: null } } } } },
    orderBy: [{ client: { clientNumber: "asc" } }, { periodEnd: "asc" }, { obligationType: { code: "asc" } }],
  });
  let current = "";
  for (const o of obligations) {
    if (o.client.clientNumber !== current) {
      current = o.client.clientNumber;
      const c = o.client;
      console.log(`\n${c.clientNumber} ${c.name}  [${c.federalState}, VAT ${c.vatFilingFrequency}${c.hasPayroll ? ", payroll" : ""}${c.hasDauerfristverlaengerung ? ", Dauerfrist" : ""}]`);
    }
    const period = `${dbToIsoDate(o.periodStart)}…${dbToIsoDate(o.periodEnd)}`;
    console.log(`  ${o.obligationType.code.padEnd(18)} ${period}  due ${dbToIsoDate(o.dueDate)}  ${o.status.padEnd(8)} docs=${o._count.fulfilments}`);
  }
  const counts = {
    clients: await db.client.count(),
    obligations: obligations.length,
    documents: await db.document.count(),
    classifications: await db.documentClassification.count(),
    fulfilments: await db.obligationFulfilment.count(),
    auditEvents: await db.auditEvent.count(),
  };
  console.log("\nTotals:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
