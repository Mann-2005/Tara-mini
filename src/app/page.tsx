// Temporary home page: shows what is in the database.
// Replaced by the dashboard in step 4.
import { db } from "@/lib/db";

// Always query the database at request time, never at build time.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [clients, obligationTypes, obligations, openObligations, documents, classifications, fulfilments, auditEvents] =
    await Promise.all([
      db.client.count(),
      db.obligationType.count(),
      db.obligation.count(),
      db.obligation.count({ where: { status: "OPEN" } }),
      db.document.count(),
      db.documentClassification.count(),
      db.obligationFulfilment.count(),
      db.auditEvent.count(),
    ]);

  const rows: [string, number][] = [
    ["Clients", clients],
    ["Obligation types", obligationTypes],
    ["Obligations", obligations],
    ["…of which open", openObligations],
    ["Documents", documents],
    ["Classifications", classifications],
    ["Fulfilments", fulfilments],
    ["Audit events", auditEvents],
  ];

  return (
    <main className="mx-auto max-w-2xl p-10 font-sans">
      <h1 className="text-2xl font-semibold">Tara Mini</h1>
      <p className="mt-2 text-gray-600">Document-chasing engine — database overview</p>
      <table className="mt-6 w-full border-collapse text-sm">
        <tbody>
          {rows.map(([label, count]) => (
            <tr key={label} className="border-b border-gray-200">
              <td className="py-2">{label}</td>
              <td className="py-2 text-right font-mono tabular-nums">{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
