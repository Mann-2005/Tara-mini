# Tara Mini

A document-chasing engine for a German tax advisory firm (*Steuerberater*).

Every client business (*Mandant*) owes the firm documents each period: bank
statements, incoming invoices, payroll data. They arrive late, incomplete, or not
at all, and staff lose hours working out who still owes what. Tara Mini answers
one question, in real time and the same way every time:

> **What is missing, from whom, by when?**

It also reads uploaded documents with an LLM. The LLM only ever *proposes* what a
document is; a person confirms or corrects it before it counts towards anything.

> **Status:** working prototype (steps 1–7 complete). Not ready for real client
> data. See [Before production](#before-production).

---

## Contents

1. [Quick start](#quick-start)
2. [What it does](#what-it-does)
3. [Architecture](#architecture)
4. [The deterministic / LLM boundary](#the-deterministic--llm-boundary)
5. [Data model](#data-model)
6. [German tax and compliance assumptions](#german-tax-and-compliance-assumptions)
7. [Testing](#testing)
8. [Seeding and sample data](#seeding-and-sample-data)
9. [Stakeholder demo script](#stakeholder-demo-script)
10. [Branding](#branding)
11. [Configuration](#configuration)
12. [Troubleshooting](#troubleshooting)
13. [Before production](#before-production)

---

## Quick start

**Requirements:** Node.js 20+ (developed on 24), pnpm, Docker Desktop (running).
A free Google Gemini API key is needed only for document classification.

```bash
pnpm install              # installs dependencies and generates the Prisma client
cp .env.example .env      # defaults match docker-compose.yml
pnpm db:up                # Postgres 16 on localhost:5433 (waits until healthy)
pnpm db:migrate           # applies all migrations, incl. GoBD triggers
pnpm db:seed              # 5 sample clients, obligations Jul–Sep 2026, document history
pnpm dev                  # http://localhost:3000
```

For document classification, add your key to `.env` (see [Configuration](#configuration)):

```bash
GOOGLE_GENERATIVE_AI_API_KEY="…"
```

> ⚠ Google's **free tier may use submitted content to improve its products**.
> Use it only with synthetic documents (`pnpm samples`). Never send real client
> documents through it. See [Data protection](#data-protection-and-professional-secrecy).

---

## What it does

| Page | Purpose |
| --- | --- |
| **What's missing** (`/`) | Every client with a red / amber / green status, sorted by urgency. Each client is split into **Client owes** (documents to chase) and **Firm to do** (filings to submit, periods to close). `?asOf=YYYY-MM-DD` shows any date. |
| **Upload** (`/upload`) | Upload a PDF or image for a client. Text is extracted, Gemini proposes type, date, amounts and counterparty, and the result is stored as an **unconfirmed proposal**. |
| **Review** (`/review`) | The original document beside the model's proposal. **Confirm** it, **Correct** it (stored as a new human row; the model's row is never changed), or **Reject** it. Confirming links the document to the obligation it fulfils. |
| **Accuracy** (`/accuracy`) | How often the model's proposals survived review unchanged: overall, per field, per document type, by confidence band, with every correction listed. |
| **Eigenbeleg** (`/eigenbeleg/new`) | Draft a substitute voucher for a missing receipt, from any missing Eingangsrechnungen row or missing-recurring-invoice row. It produces a printable PDF voucher (0,00 EUR input VAT, § 15 UStG), stored as a draft receipt that counts only after review. |

The dashboard also shows the **intelligence layer**: a **Compliance Score** per client
(Grade A–D from delivery timeliness), a **VAT forecast** for the next return
(Vorsteuer, Umsatzsteuer, estimated Zahllast or Guthaben), and **missing recurring
invoices** (a vendor that normally invoices monthly but hasn't this month). All
three are deterministic calculations in `src/domain/analytics/`, never AI.

The workflow, end to end:

```
 obligation rules ──► generator ──► Obligation rows (with due dates)
                                          │
 upload ─► extract text ─► LLM proposal ─► human review ─► ObligationFulfilment
                              (unconfirmed)   (confirm /        │
                                               correct)         ▼
                                                      gap engine (pure) ─► dashboard
                                                              │
                                     proposal vs confirmed ───┴─► accuracy page
```

---

## Architecture

### Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 15 (App Router, Server Components, Server Actions), TypeScript, Tailwind CSS 4 (TARA brand theme) |
| Database | PostgreSQL 16 (Docker), Prisma 7 with the `pg` driver adapter |
| LLM | Vercel AI SDK 7 (`generateText` + `Output.object`) with `@ai-sdk/google`, model `gemini-3.8-flash` |
| Validation | Zod 4 (strict schemas for model output and reviewer input) |
| PDF text | `unpdf` (pdf.js), deterministic text-layer extraction |
| Tests | Vitest 5: unit tests plus integration tests on an isolated Postgres database |

### Source layout

```
src/
├── domain/                  PURE logic: no database, no network, no clock, no LLM
│   ├── calendar/            ISO dates, German public holidays per state, working days (§108 AO)
│   ├── obligations/         due-date rule interpreter, obligation generator, standard obligation types
│   ├── gaps/                the gap engine: computeGaps({ asOf, clients, obligations })
│   ├── fulfilment/          which obligation a confirmed document can fulfil (suggestion + validation)
│   ├── accuracy/            LLM proposal vs confirmed truth
│   ├── analytics/           V2: Compliance Score, VAT forecast, missing recurring invoices (100 % covered)
│   ├── eigenbeleg/          V2: substitute-voucher validation and content (100 % covered)
│   ├── classificationFields.ts   the reviewable fields + changedFields (shared by review and accuracy)
│   └── money.ts             German / plain money parsing
│
├── ai/                      the ONLY code that talks to an LLM
│   ├── documentSchema.ts    strict Zod contract for model output
│   ├── classifyDocument.ts  prompt + structured-output call; returns a proposal, never writes
│   └── model.ts             model selection from env (GEMINI_MODEL)
│
├── server/                  database-side services (Prisma), all writes audited
│   ├── documents/           upload pipeline: validate → hash → store → extract → classify
│   ├── review/              confirm / correct / reject, in one transaction each
│   ├── obligations/         idempotent obligation sync, completion
│   ├── gaps/, accuracy/     loaders: read facts from the DB for the pure functions
│   ├── audit.ts             append-only audit writer
│   ├── clock.ts             the ONLY place that reads "today" (Europe/Berlin)
│   └── currentUser.ts       acting user (placeholder: staff:demo)
│
├── app/                     Next.js pages, server actions, the document file route
├── lib/db.ts                shared Prisma client
└── generated/prisma/        generated client (gitignored)

prisma/      schema, migrations (incl. hand-written GoBD triggers), seed
scripts/     gap-report.ts (CLI gap report), make-samples.ts (synthetic PDFs)
test/db/     global setup for the integration-test database
```

### Design principles

1. **Rules are data, not code.** Each obligation type (UStVA, Kontoauszüge…) is a
   database row describing its recurrence, due-date rule and fulfilment rule. One
   generic, tested interpreter handles all of them.
2. **Store decisions, derive time.** The database stores only what people or the
   system decided (`OPEN`, `COMPLETE`, `WAIVED`). "Overdue" and "due soon" are
   computed from an explicit as-of date, so nothing goes stale and no nightly job
   flips statuses.
3. **Calendar dates are dates.** Periods, due dates and document dates are
   `@db.Date` columns and `"YYYY-MM-DD"` strings in code, so no time zone can
   shift a deadline by a day.
4. **Nothing is deleted.** Corrections add rows; rejections and revocations set
   status fields. The database enforces this (see [GoBD](#gobd)).
5. **Thin loaders, pure cores.** Each page loads facts with Prisma, hands them to
   a pure function, and renders the result. The judgement lives in the tested
   pure function.

---

## The deterministic / LLM boundary

This is the project's core architectural rule.

| | Deterministic side | LLM side |
| --- | --- | --- |
| **Answers** | What is missing, from whom, by when? | What does this document seem to be? |
| **Code** | `src/domain/**` (pure), loaders in `src/server/**` | `src/ai/**` only |
| **Inputs** | Database facts + an explicit as-of date | Extracted text, or the file itself |
| **Output** | Authoritative: drives the dashboard | A **proposal**: an unconfirmed `DocumentClassification` row |
| **Repeatable?** | Yes: same data and date → identical result (tested) | No. Temperature 0, but treated as untrusted |

### How the boundary is enforced

- **Module separation.** `src/ai/` never imports Prisma or the database.
  `src/domain/` never imports Prisma, the AI SDK, or the clock.
- **Proposals count for nothing.** The gap engine counts only fulfilments whose
  classification a human confirmed (`confirmedAt IS NOT NULL`) and which are not
  revoked. An unreviewed proposal never changes the dashboard. Schmidt's
  September bank statement in the seed shows this: it was uploaded and
  classified, but is still listed as missing until someone confirms it.
- **Strict output contract.** Model output must match a `z.strictObject` schema:
  known document type, valid ISO date, confidence 0–1, ISO currency code, no
  extra fields. Anything else is rejected and the document stays *Not classified*,
  with a Retry button.
- **The human decides the link.** Which obligation a document fulfils is
  *suggested* by a pure, tested function (`matchObligations`), chosen by the
  reviewer, and re-validated on the server (same client, accepted document type).
- **The model's answer is preserved.** A correction inserts a new `HUMAN` row that
  supersedes the `LLM` row. The LLM row is never edited, and a Postgres trigger
  rejects any attempt. This is what makes the accuracy page possible.
- **Deterministic extraction first.** For digital PDFs the text layer is read
  without the model, so the stored text is exactly what the file contains. Only
  images and scanned PDFs are sent to the model for transcription, and the audit
  log records that the text came from the model.
- **Prompt-injection hygiene.** Document content is marked as untrusted data in
  the instructions, and the output can only take schema-valid values. One of the
  synthetic samples contains an injected instruction, which Gemini ignored in
  testing.

### What "deterministic" is tested against

- the same input twice gives deep-equal output;
- reversed input order gives identical output;
- the input is not mutated;
- faking the system clock to 2030 changes nothing (the engine never reads it).

---

## Data model

```
Client ──< Obligation >── ObligationType            (rules as data)
  │            │
  │            └──< ObligationFulfilment >── Document ──< DocumentClassification
  └──< Document                                   (LLM proposal / HUMAN correction)

AuditEvent   (append-only; references any entity by type + id)
```

| Model | Key points |
| --- | --- |
| `Client` | VAT filing frequency (`MONTHLY` / `QUARTERLY` / `NONE`), payroll, Dauerfristverlängerung, fiscal-year-end month, federal state (for holidays), `isActive` instead of deletion |
| `ObligationType` | `kind` (`CLIENT_DELIVERY` / `FIRM_FILING`), `appliesWhen`, `recurrence`, due-date parameters, accepted document types, `minDocuments`, `requiresManualCompletion` |
| `Obligation` | One per client, type and period (unique). `dueDate` is materialised by the pure due-date function. Stored status: `OPEN` / `COMPLETE` / `WAIVED` only |
| `Document` | File metadata, **SHA-256** (integrity and duplicate detection), extracted text, status `PENDING` → `PROPOSED` → `CONFIRMED` / `REJECTED`, `origin` `UPLOAD` / `EIGENBELEG` (substitute vouchers are flagged for auditors) |
| `DocumentClassification` | Immutable rows: `source = LLM` (with `modelUsed`, `confidence`) or `HUMAN` (with `supersedesId`). Exactly one per document gets `confirmedBy` / `confirmedAt` |
| `ObligationFulfilment` | Links a confirmed document (and the confirmed classification) to an obligation. Revoked via `revokedAt`, never deleted |
| `AuditEvent` | Who, what, when, old → new, reason. UPDATE and DELETE are rejected by the database |

Money is stored as `DECIMAL(12,2)` and handled as exact strings (`"8925.00"`),
never as floating point.

---

## German tax and compliance assumptions

> **Read this section critically.** The items marked **Assumption** are
> practice choices or simplifications that a Steuerberater should confirm. The
> same items are marked `⚠` / `ASSUMPTION` in code comments.

### Umsatzsteuervoranmeldung (UStVA)

| Rule | Status | Where |
| --- | --- | --- |
| Due on the **10th day after the end of the filing period** | Statutory: §18 Abs. 1 UStG | `standardTypes.ts`, `dueDate.ts` |
| Filing period is the month or the calendar quarter, per client | Modelled as client data; the §18 Abs. 2 UStG thresholds that decide it are **not** computed | `Client.vatFilingFrequency` |
| Quarters are **calendar** quarters, even for a non-calendar fiscal year | Assumption (the VAT year is the calendar year, §16 UStG) | `generate.ts` |
| VAT-exempt businesses (e.g. physiotherapy, §4 Nr. 14 UStG) file no UStVA | Modelled as `vatFilingFrequency = NONE` | seed client 10004 |
| UStVA is a **firm filing**, fulfilled by uploading the ELSTER *Übermittlungsprotokoll* | Design decision | `kind = FIRM_FILING` |
| An ELSTER receipt belongs to the latest open period that ended before its transmission date | Assumption (suggestion only; the reviewer can change it) | `matchObligations.ts` |

### Dauerfristverlängerung

| Rule | Status |
| --- | --- |
| Extends the UStVA deadline by **one month** | Statutory: §§46–48 UStDV |
| Applies to monthly and quarterly filers | Modelled |
| **Sondervorauszahlung** (1/11 of the prior year's VAT, monthly filers) | **Not modelled** |
| The firm's internal deadline for client documents moves by the same month | **Assumption** (firm policy) |
| Payroll data deadlines are **not** affected | **Assumption** (it is a VAT-only extension) |

### Deadlines and holidays

| Rule | Status |
| --- | --- |
| A deadline on a Saturday, Sunday or public holiday moves to the **next working day** | Statutory for tax deadlines: §108 Abs. 3 AO |
| The same roll-forward is applied to the firm's **internal** deadlines | **Assumption** (a choice, not law) |
| Holidays are computed **per federal state** (Easter-based dates plus fixed dates), in pure code | Modelled for all 16 states, incl. Frauentag (BE since 2019, MV since 2023), Weltkindertag (TH), Buß- und Bettag (SN) |
| The client's state equals its Finanzamt's state | **Assumption** |
| Mariä Himmelfahrt is treated as **Bavaria-wide** | **Assumption** (officially only Catholic-majority municipalities) |
| Fronleichnam in parts of Saxony and Thuringia, the Augsburg Friedensfest, and one-off holidays (e.g. 8 May 2025 in Berlin) are **not** included | Simplification |
| A deadline runs until the end of the due date: due today is not overdue | Standard reading (§108 AO / §188 BGB) |

### Client document deadlines (firm policy, all **Assumptions**)

| Obligation | Recurrence | Due | Fulfilled by |
| --- | --- | --- | --- |
| Kontoauszüge | Monthly, every client | 5th of the following month (+1 month with Dauerfrist) | 1 bank statement → completes automatically |
| Eingangsrechnungen | Monthly, every client | 5th of the following month (+1 month with Dauerfrist) | ≥ 1 invoice or receipt, then **staff closes the period** |
| Lohndaten | Monthly, clients with payroll | **15th of the same month**, so payroll runs before social-security contributions fall due (third-last banking day, §23 Abs. 1 SGB IV) | 1 payroll file → completes automatically |

Other simplifications: the Lohnsteuer-Anmeldung (§41a EStG) is not modelled as its
own obligation. The fiscal year is assumed to end on the last day of a month.
"Due soon" means within **7 days**, which is configurable.

### Eigenbeleg (substitute voucher)

| Rule | Status |
| --- | --- |
| A business expense may be booked without its receipt if a substitute voucher records payee, date, amount, what was bought, why the original is missing, the business purpose, and is signed | Common practice (GoBD: verifiable, complete). Statutory field list does not exist; the voucher follows common practice |
| **No input VAT** can be deducted: an Eigenbeleg is not an invoice under § 14 UStG | Statutory: § 15 Abs. 1 Nr. 1 UStG. The voucher always carries 0,00 EUR VAT; the form requires an explicit acknowledgement |
| No amount limit, but tax offices accept Eigenbelege mainly for small amounts | **Assumption:** above 250 EUR (the Kleinbetragsrechnung limit, § 33 UStDV) the app **warns** to request a duplicate invoice; it doesn't block |
| The expense date must fall inside the period it is booked to | Design decision (so the deterministic matcher links it to that period at review) |
| Vouchers are numbered per client (EB-10003-0001, …) | Design decision. **Limitation:** two drafts at the same instant could share a number |
| A drafted Eigenbeleg counts only after review; it is never counted as AI output on the accuracy page | Design decision (four-eyes principle; staff-entered, not model-proposed) |

### GoBD

The *Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern…*
(BMF letter on GoBD) require that accounting-relevant records are traceable and
cannot be altered unnoticed. In Tara Mini this is **enforced by the database**,
not just by convention:

| Guarantee | Mechanism |
| --- | --- |
| No record is ever deleted | Postgres trigger rejects `DELETE` and `TRUNCATE` on every domain table |
| The audit log is append-only | Trigger rejects `UPDATE` on `AuditEvent` |
| An LLM proposal can't be rewritten | Trigger allows only the one-time confirmation on `DocumentClassification`; all other updates are rejected |
| Every state change is traceable | Each change writes an `AuditEvent` (actor, action, old → new, reason) **in the same transaction** |
| Originals are verifiable | Files are stored by SHA-256 and re-verified on every read |
| Corrections keep history | A correction is a new `HUMAN` row that points to the `LLM` row it supersedes |

Not covered yet: retention periods (§147 AO), procedural documentation
(*Verfahrensdokumentation*), real user identities (all actions are currently
`staff:demo`), and tamper evidence beyond database permissions (e.g. a hash chain).

### Data protection and professional secrecy

Steuerberater are bound by professional secrecy (§203 StGB, §57 StBerG) and the
GDPR. Sending client documents to an external model requires a **data processing
agreement (AVV, Art. 28 GDPR)** and a provider tier that does not use the data for
training. **Google's free tier does not meet this.** It may use submitted content to
improve Google's products. The prototype is therefore limited to synthetic documents.

---

## Testing

| Command | What runs | Needs |
| --- | --- | --- |
| `pnpm test` | **310 unit tests**: holidays, working days, due dates, generator, gap engine, matching, field parsing, accuracy, LLM classifier (against a mock model), PDF extraction, formatting, the V2 analytics, Eigenbeleg rules and voucher PDF | nothing |
| `pnpm test:coverage` | The unit tests with **100 % coverage enforced** on `src/domain/analytics`, `src/domain/eigenbeleg` and money arithmetic (fails below 100 %) | nothing |
| `pnpm test:db` | **23 integration tests**: review flow (confirm, correct, close, reject, races, rollbacks, GoBD trigger), accuracy pairing, the insights loader (time travel, Berlin midnight), and the Eigenbeleg lifecycle, on real Postgres | Docker running |
| `pnpm lint`, `pnpm build` | ESLint; type-checked production build | – |

Highlights from the unit suite:

- **Weekends:** September 2026 UStVA → Sat 10 Oct moves to Mon 12 Oct; not overdue on the weekend, overdue on Tue 13 Oct.
- **State holidays:** Mariä Himmelfahrt 2025 (a Friday) moves a Bavarian deadline to Monday but not one in NRW; Karfreitag + weekend + Ostermontag → Tuesday.
- **Dauerfrist:** monthly, quarterly and across the year boundary; does not move payroll.
- **Clients without payroll or VAT:** never flagged for Lohn or UStVA.
- **Determinism:** identical output on repeat, on reversed input, and with a faked clock.
- **LLM contract:** eight kinds of invalid model output are rejected.

**The integration tests never touch your data.** They use a separate database,
`tara_mini_test`, in the same container. Its schema is dropped and rebuilt from the
migrations on every run, and the setup refuses to reset any database whose name
doesn't end in `_test`. To create it once:

```bash
docker exec tara-mini-db psql -U tara -d postgres -c "CREATE DATABASE tara_mini_test"
```

Several tests were also checked by **mutation**: deliberately breaking the code
(e.g. treating "due today" as overdue, ignoring Dauerfrist, dropping a holiday,
loosening the schema, confirming the LLM row despite corrections) made the
relevant tests fail each time.

---

## Seeding and sample data

```bash
pnpm db:seed                         # idempotent; anchored at 2026-10-02
SEED_AS_OF=2026-11-15 pnpm db:seed   # obligations for another window (no scripted documents)
pnpm gaps 2026-10-02                 # print the gap report in the terminal
pnpm samples                         # write synthetic PDFs to ./samples
```

The seed is **reproducible** (a fixed anchor date) and **idempotent** (running it
twice creates nothing new). Every seeded write is audited as `system:seed`, and
seeded "model" proposals use `modelUsed = "seed-fixture"`, so they never pass for
real model output. The accuracy page labels them "Sample data (seed)".

### Seeded clients (anchor date 2 Oct 2026)

The seed covers six months. **Jul–Sep 2026** is the live story on the dashboard.
**Apr–Jun 2026** is generated, fully completed history: every obligation was
delivered with that client's typical lateness, which feeds the Compliance Score.

| No. | Client | Profile | Story on 2 Oct 2026 | Compliance Score | VAT forecast | Missing recurring invoice |
| --- | --- | --- | --- | --- | --- | --- |
| 10001 | Bäckerei Müller GmbH | BY, monthly VAT, payroll | **Green**: fully up to date; September UStVA due Mon 12 Oct | **A • 100** (always early) | Sep: Zahllast 727,00 | – |
| 10002 | Schmidt IT-Beratung | BE, quarterly VAT, no payroll | **Amber**: September bank statement uploaded but **not yet reviewed**, so still missing | **B • 86** (2–4 days late) | Q3: Zahllast 5.586,00 | – |
| 10003 | Weber Bau GmbH | NW, monthly VAT, payroll, **Dauerfrist** | **Red**: August and September payroll data overdue | **D • 39** (avg 20 days late) | Aug: Zahllast 3.792,40 | **Telefónica (O2), ~47,60** |
| 10004 | Physiotherapie Fischer | HH, **VAT-exempt**, payroll | **Amber**: August invoices received but the period isn't closed | **C • 69** (1–2 weeks late) | none (VAT-exempt) | Physio-Bedarf Nord, ~285,60 |
| 10005 | Becker Online-Handel UG | BW, quarterly VAT, **Dauerfrist**, fiscal year ends June | **Green**: September due 5 Nov, Q3 UStVA due 10 Nov | **A • 98** | Q3: **Guthaben** 684,00 | DHL Paket, ~1.249,50 |

Only Weber's Telefónica gap was scripted. Fischer's and Becker's missing invoices
are genuine detections: both clients sent an invoice from that supplier in July
and August, and September's hasn't arrived. `pnpm insights 2026-10-02` prints all
of this in the terminal.

### Synthetic sample documents (`pnpm samples`)

| File | Tests |
| --- | --- |
| `Rechnung_Kraemer_2026-09.pdf` | Invoice addressed to Weber: the model must name the **issuer** (Krämer), not the client |
| `Kontoauszug_2026-09.pdf` | Bank statement: the date must be the end of the statement period |
| `Quittung_Tankstelle_2026-09.pdf` | Receipt containing an **injected instruction**, which the model must ignore |

### Starting over

Because of the GoBD triggers, rows can't be deleted. To start from scratch, drop
and recreate the schema:

```bash
pnpm db:reset    # asks for confirmation; then:
pnpm db:seed
```

---

## Stakeholder demo script

About 30 minutes. Each step lists **what to do**, **what they'll see**, and **the
point to make**.

### Before the demo

```bash
pnpm db:up
pnpm db:reset && pnpm db:seed     # clean, known state
pnpm samples                      # synthetic PDFs in ./samples
pnpm dev
```

Check that `GOOGLE_GENERATIVE_AI_API_KEY` is set. Open
`http://localhost:3000/?asOf=2026-10-02`. The demo story is anchored at
**2 October 2026**, so always keep `?asOf=2026-10-02` on the dashboard URL.

### 1. The problem, in one screen (3 min)

**Do:** open the dashboard at `/?asOf=2026-10-02`.

**They see:** "What's missing as of Friday, 2 October 2026", then one client
**Overdue** (Weber), two **Needs attention** (Fischer, Schmidt), two **On track**.

**Say:**
- "Instead of each person checking folders and emails, this is the whole firm's
  chasing list, worst first."
- Point at Weber: "Two months of payroll data are overdue. That's a phone call today."
- Point at the two columns: "On the left, what the *client* owes us. On the right,
  on the green panel, what *we* owe: a VAT filing, or closing a month whose
  invoices are in. So we know who has to act."

### 2. The tax rules are built in (4 min)

**Do:** stay on Weber and Müller.

**Say:**
- **Weekend rule:** "Müller's September UStVA is due the 10th, but 10 October 2026
  is a Saturday, so the deadline is Monday 12 October (§108 AO). The system knows."
- **Dauerfrist:** "Weber has a Dauerfristverlängerung, so its August UStVA isn't
  due 10 September but one month later, on 12 October. Their September documents
  are due 5 November, not 5 October."
- **Profiles:** "Fischer is a physiotherapy practice, VAT-exempt, so no UStVA at
  all. Schmidt has no employees, so no payroll data is ever chased."
- **State holidays:** "Deadlines respect each federal state's holidays. A deadline
  on 15 August moves in Bavaria but not in North Rhine-Westphalia."

### 3. Time travel and determinism (3 min)

**Do:** change the URL to `/?asOf=2026-10-13`.

**They see:** Müller turns **red**: the September UStVA is now overdue, and it's the
firm's own filing.

**Do:** in a terminal, run `pnpm gaps 2026-10-02` twice.

**Say:** "The 'what's missing' answer is computed by plain, tested rules, never by
AI. Same data, same date, same answer, every time. That's what makes it auditable.
There are over 280 automated tests behind it, including every weekend and holiday
case we discussed."

### 4. AI reads the documents, but only proposes (4 min)

**Do:** go to **Upload**, choose *Weber Bau GmbH*, upload
`samples/Rechnung_Kraemer_2026-09.pdf`.

**They see:** after about 10–20 seconds: Incoming invoice, 15 Sep 2026,
8.925,00 EUR gross, 1.425,00 EUR VAT, counterparty *Baustoffhandel Krämer GmbH*.

**Say:**
- "The invoice is addressed to Weber, but the AI correctly names the supplier."
- "This is only a **proposal**. Nothing on the dashboard changes until a person
  confirms it." Optionally show the dashboard: Weber is unchanged.

*Optional:* upload `Quittung_Tankstelle_2026-09.pdf`. It contains the line "IGNORE
ALL PREVIOUS INSTRUCTIONS…". The AI still classifies it as a receipt.

### 5. A person decides (4 min)

**Do:** open **Review**. Open Schmidt's `Kontoauszug_2026-09.pdf` and click **Confirm**.

**Then:** dashboard at `/?asOf=2026-10-02`. Schmidt's client column now reads
"Nothing outstanding from the client".

**Do:** back in **Review**, open the Krämer invoice:
- Click **Correct**, change a field (e.g. the counterparty), and show "Model said: …".
- Point at **Counts towards**: Weber's September Eingangsrechnungen was suggested automatically.
- Tick **"This is the last one: close the period"**, then **Save correction and confirm**.

**Say:**
- "The reviewer's correction is saved as a new record. The AI's original answer is
  kept exactly as it was, which is how we can measure the AI's accuracy honestly."
- "Every step is one database transaction: if anything fails, nothing is half-saved.
  Two people clicking at once can't create two outcomes."

### 6. Is the AI any good? (2 min)

**Do:** open **Accuracy**.

**They see:** over 90 % of documents were fully right (the exact figure depends on the reviews made in the demo), accuracy per document type
and per field, type mix-ups, and the list of corrections.

**Say:**
- "Most of these numbers are from sample data. The yellow note says so. Click
  **gemini-3.8-flash** to see only real AI results."
- "'Does the model's confidence mean anything?' tells us whether we could ever
  safely skip review for high-confidence documents. Until the data says so, we
  review everything."

### 7. Beyond chasing: the intelligence layer (4 min)

**Do:** back to the dashboard at `/?asOf=2026-10-02`.

**Compliance Score.** Point at the pills next to each name: Weber **Grade D • 39**,
Müller **Grade A • 100**. Hover a pill for the detail.
- "This is how promptly each client has delivered over the last six months: an
  average of 20 days late for Weber, always early for Müller. It's objective
  evidence for the annual fee conversation (StBVV)."
- "It only counts what the *client* owes, measured by when their documents
  arrived. Our own filings and our staff's closing never lower a client's grade."

**Missing recurring invoice.** Point at Weber's dashed row: *"Missing expected
recurring invoice: Telefónica Germany GmbH & Co. OHG (~47,60 EUR)"*.
- "Weber's O2 bill arrived in June, July and August. September's hasn't. The
  system noticed before anyone closes the month, so we can ask now rather than
  find out at year end."
- "Nobody configured that. Fischer's and Becker's rows were found the same way,
  from the documents alone. And it never changes a client's red/amber/green:
  it's a prompt to ask, not a deadline."

**VAT forecast.** Point at the panel at the bottom of each block: Weber owes an
estimated **3.792,40 EUR** for August, while Becker gets **684,00 EUR back**
for Q3 after a large stock purchase.
- "Clients see the VAT bill coming before the return is filed, so it's not a
  month-end shock."
- "It's provisional, as the note says: it uses confirmed documents only and
  assumes VAT follows the invoice date (Sollversteuerung)."

**Time travel, again:** open `/?asOf=2026-09-15`. Müller's, Schmidt's and Becker's VAT panels
switch to "Running total, counted until 15 Sep", and Schmidt's Hetzner invoice now shows
as missing, because on that day it hadn't arrived.

**Say:** "All three are plain, tested calculations: no AI. The AI only reads
documents; everything you just saw is arithmetic you can check."

### 8. Missing receipt? Draft an Eigenbeleg (3 min)

**Do:** on Weber's *"Missing expected recurring invoice: Telefónica…"* row, click
**Draft Eigenbeleg**.

**They see:** the form already filled in: Weber's September Eingangsrechnungen,
3 September, 47,60 EUR, Telefónica. Add what was bought and the business purpose.
Point at the **VAT** panel: *no input VAT can be deducted (§ 15 UStG)*, with a
required acknowledgement. Click **Create Eigenbeleg**.

**Then:** the review page opens with the generated **PDF voucher** beside the
fields: number EB-10003-0001, the statutory content, the § 15 UStG note and a
signature line. Click **Confirm**: it now counts towards September.

**Say:**
- "When a minor receipt is lost, staff produce a compliant substitute voucher in a
  minute instead of an email chain. It's stored unchangeably like any upload and
  flagged as an Eigenbeleg for the auditor."
- "It still goes through review, and it never counts as AI output: staff entered it."

**Show the effect:** click **Back to today** on the dashboard. Weber's Telefónica
row is gone. (On 2 October it is still there: the voucher was created today, and
the insights only use what was known on the chosen date.)

### 9. Compliance by construction (optional, 2 min)

**Do:** in a terminal:

```bash
docker exec tara-mini-db psql -U tara -d tara_mini -c 'DELETE FROM "Client";'
docker exec tara-mini-db psql -U tara -d tara_mini -c 'UPDATE "AuditEvent" SET actor = actor;'
```

**They see:** `ERROR: GoBD: DELETE on "Client" is not allowed…` and
`ERROR: GoBD: AuditEvent is append-only…`

**Say:** "These guarantees are enforced by the database itself, not by
application code that a bug could bypass. Every change is in an append-only
audit log: who, what, when, old value, new value."

### 10. Close with what's next (1 min)

- Login and access control, so every action is tied to a real person (GoBD).
- A paid AI tier with a data processing agreement before any real client document.
- Firm-specific deadlines: the rules are data, so changing a deadline is
  configuration, not code.

---

## Branding

The UI uses TARA's brand identity, taken from the design variables on taratax.ai:
forest green `#003d18` (primary), lime `#defe52` (accent, only on green), mint
`#bdffd7`, ink `#002910`, page `#f4f4f4`, the **Public Sans** typeface, and the
signature asymmetric corners (buttons rounded only bottom-right; cards 10/10/40/10px).

| What | Where |
| --- | --- |
| Colour, font, radius and shadow tokens; `btn-primary` / `btn-secondary` / `btn-danger` / `card` / `field` | `src/app/globals.css` (Tailwind 4 configures its theme in CSS, so there is no `tailwind.config.ts`) |
| Typeface | `src/app/layout.tsx` (`next/font` Public Sans) |
| Firm name, product name, **logo** | `src/app/_components/brand.ts`: put the logo in `public/brand/` and set `logoSrc`; until then the nav shows a placeholder of the same size |

Two deliberate deviations for accessibility: secondary text is ink at 68 % rather
than the site's 60 % (which fails WCAG AA on white), and lime is never used as text
on a light background. The status green (`#237a57`) is kept lighter and bluer than the
brand green, so "on track" never reads as decoration.

## Configuration

`.env` (copy from `.env.example`; never commit it):

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | `postgresql://tara:tara@localhost:5433/tara_mini?schema=public` | Postgres connection |
| `GOOGLE_GENERATIVE_AI_API_KEY` | for uploads | – | Gemini API key (https://aistudio.google.com/apikey) |
| `GEMINI_MODEL` | no | `gemini-3.8-flash` | Override the model (`gemini-1.5-flash` and `gemini-2.0-flash` are retired) |
| `STORAGE_DIR` | no | `./storage` | Where uploaded originals are stored |
| `TEST_DATABASE_URL` | no | `…/tara_mini_test` | Database for `pnpm test:db` (name must end in `_test`) |
| `SEED_AS_OF` | no | `2026-10-02` | Anchor date for `pnpm db:seed` |

### All scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` / `build` / `start` | Next.js development server / production build / production server |
| `pnpm db:up` / `db:down` | Start / stop the Postgres container (data persists in a Docker volume) |
| `pnpm db:migrate` | Apply migrations (`prisma migrate dev`) |
| `pnpm db:seed` | Seed sample data (idempotent) |
| `pnpm db:reset` | Drop and recreate the schema and re-apply migrations (then seed again) |
| `pnpm db:studio` | Browse the database in Prisma Studio |
| `pnpm test` / `test:watch` | Unit tests |
| `pnpm test:db` | Integration tests on `tara_mini_test` |
| `pnpm gaps [YYYY-MM-DD]` | Print the gap report for a date (default: today in Berlin) |
| `pnpm samples` | Generate synthetic sample PDFs in `./samples` |

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `ECONNREFUSED …:5433` or the pages fail to load | Docker Desktop or the container is stopped. Start Docker Desktop, then `pnpm db:up`. Your data survives in the volume. |
| Upload says "GOOGLE_GENERATIVE_AI_API_KEY is not set" | Add the key to `.env` and restart `pnpm dev`. The document is kept; press **Retry** in the upload list. |
| "Gemini's rate limit was reached" | The free tier allows only a few requests per minute. Wait a minute, then **Retry**. |
| "…was already uploaded for this client" | Duplicate detection by SHA-256. Upload it for another client, or a different file. |
| `ERROR: GoBD: DELETE … is not allowed` | Intentional. Use status fields, or `pnpm db:reset` to start over. |
| `pnpm db:reset` refuses to run inside an AI coding assistant | Prisma requires explicit user consent for resets started by AI agents. Run it yourself. |
| `prisma migrate dev` shows "Update available 7.x → 8.0.0-rc" | Prisma is pinned to stable 7.10.0 on purpose. Ignore it. |
| `pnpm install` reports ignored build scripts | The allowlist is in `pnpm-workspace.yaml` (`allowBuilds`). |

---

## Before production

This prototype deliberately stops short of production. Before any real client data:

1. **Authentication and authorisation.** Replace `staff:demo` (`src/server/currentUser.ts`)
   with signed-in users. Protect every page, server action, and especially the
   document file route `src/app/api/documents/[id]/file` (flagged by a security review).
2. **AI data processing.** A paid model tier with an AVV / DPA, or a self-hosted model.
3. **GoBD completeness.** Retention rules (§147 AO), *Verfahrensdokumentation*,
   backups, tamper evidence (e.g. hash-chained audit events), and object storage
   with immutability in place of local disk.
4. **Firm configuration.** Let the firm edit obligation types and deadlines
   (internal deadlines, due-soon horizon) through an audited admin flow.
5. **Validation by a Steuerberater** of every assumption listed above.
6. **One time-travel rule for the whole dashboard.** The insights (score, VAT, missing
   invoices) only use documents uploaded by the as-of date. The red/amber/green list
   uses each obligation's *current* stored status. Viewing a past date can therefore
   show a document that arrived later as received, while its missing-invoice row is
   still shown. Fix: derive obligation status as of the date, too.

---

## Project history

Built in seven reviewed steps, one commit each:

| Commit | Step |
| --- | --- |
| `75a1e78` | 1. Scaffold: Next.js 15, Prisma 7, local Postgres |
| `743bc49` | 2. Domain schema, obligation generator, GoBD triggers, seed |
| `4703067` | 3. Deterministic gap engine with Vitest suite |
| `378ccba` | 4. Dashboard of missing documents by urgency |
| `f14e3ab` | 5. Upload page with Gemini classification proposals (+ `a15eaeb` rate-limit message) |
| `0b8f898` | 6. Review page: confirm, correct, reject |
| `e19f738` | 7. Classification accuracy page |
| `b9c446c` | TARA brand identity |
| `c9ea8a2` | V2.1 Pure analytics engines (Compliance Score, VAT forecast, missing recurring invoices) |
| `69fa896` | V2.2 Demo scenarios in the seed, analytics loaders |
| `c4e48c4` | V2.3 Intelligence layer on the dashboard |
| (this commit) | V2.4 Eigenbeleg generator |
