// Single shared Prisma client for the app.
// Prisma 7 talks to Postgres through a driver adapter (node-postgres here).
// In dev, Next.js hot-reloads modules, so we cache the client on globalThis
// to avoid opening a new connection pool on every reload.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
};

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
