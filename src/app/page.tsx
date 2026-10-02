// Temporary home page for step 1: proves Next.js → Prisma → Postgres works.
// Replaced by the dashboard in step 4.
import { db } from "@/lib/db";

// Always query the database at request time, never at build time.
export const dynamic = "force-dynamic";

export default async function Home() {
  const clientCount = await db.client.count();

  return (
    <main className="mx-auto max-w-2xl p-10 font-sans">
      <h1 className="text-2xl font-semibold">Tara Mini</h1>
      <p className="mt-2 text-gray-600">Document-chasing engine — scaffold</p>
      <p className="mt-6 rounded border border-green-300 bg-green-50 p-4 text-green-900">
        Database connected. Clients in database: <strong>{clientCount}</strong>
      </p>
    </main>
  );
}
