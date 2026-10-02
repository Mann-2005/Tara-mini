# Tara Mini

Document-chasing engine for a German tax advisory firm (Steuerberater):
computes, deterministically, what each client (Mandant) still owes, and by when.

## Stack

Next.js 15 (App Router, TypeScript) · Prisma 7 + PostgreSQL 16 · Tailwind CSS 4 ·
Vercel AI SDK (Anthropic) for document classification · Vitest

## Setup

Requires Node 20+, pnpm, and Docker Desktop (running).

```bash
pnpm install            # also runs `prisma generate`
cp .env.example .env    # defaults match docker-compose.yml
pnpm db:up              # start Postgres on localhost:5433
pnpm db:migrate         # apply migrations
pnpm dev                # http://localhost:3000
```

## Scripts

| Script            | What it does                              |
| ----------------- | ----------------------------------------- |
| `pnpm db:up`      | Start the Postgres container (waits until healthy) |
| `pnpm db:down`    | Stop it (data persists in a Docker volume) |
| `pnpm db:migrate` | Create/apply migrations (`prisma migrate dev`) |
| `pnpm db:studio`  | Browse the database in Prisma Studio      |
| `pnpm db:seed`    | Seed 5 clients, obligation types, obligations Jul–Sep 2026 and a document history (idempotent; `SEED_AS_OF=YYYY-MM-DD` to change the anchor) |
| `pnpm test`       | Run the Vitest unit tests (pure domain logic, no database needed) |
| `pnpm gaps [date]` | Print the gap report for the database, as of today (Europe/Berlin) or a given YYYY-MM-DD |
| `pnpm db:reset`   | Drop and recreate the schema, re-apply migrations (then run `pnpm db:seed`) |

## Architecture

```
src/domain/      pure, deterministic logic — no Prisma, no I/O, no LLM
  calendar/      ISO dates, German public holidays per state, working days (§108 AO)
  obligations/   due-date rule interpreter, obligation generator, standard types
  gaps/          gap engine: computeGaps({asOf, clients, obligations}) → per-client RAG + gaps
src/server/      database-side services (audit log, obligation sync)
src/ai/          (step 5) LLM classification — proposals only
prisma/          schema, migrations (incl. GoBD triggers), seed
```

**GoBD:** nothing is ever hard-deleted. Postgres triggers reject `DELETE`/`TRUNCATE`
on all domain tables, any `UPDATE` on `AuditEvent`, and edits to classifications
(other than the one-time confirmation). Use status / revocation fields instead.
