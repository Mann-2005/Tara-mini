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
