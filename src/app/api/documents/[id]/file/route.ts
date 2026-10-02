// Serves an uploaded original for the review page's viewer.
// The bytes are verified against the stored SHA-256 before being sent.
// ASSUMPTION / TODO: no authentication yet — anyone who can reach the app can
// fetch a document by id. Must be access-controlled before real use.

import { db } from "@/lib/db";
import { ACCEPTED_MIME_TYPES, readOriginal } from "@/server/documents/storage";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await db.document.findUnique({ where: { id } });
  if (!document || !ACCEPTED_MIME_TYPES.includes(document.mimeType)) return new Response("Not found", { status: 404 });

  let bytes: Uint8Array;
  try {
    bytes = await readOriginal(document.storagePath, document.sha256);
  } catch {
    return new Response("Original file not available", { status: 404 });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
