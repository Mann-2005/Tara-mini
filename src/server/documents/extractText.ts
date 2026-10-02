// Deterministic text extraction. Runs BEFORE the LLM, so for digital PDFs
// the stored rawText is exactly what the file contains, not a model's reading
// of it. Images and scanned PDFs have no text layer; the classifier then gets
// the file itself and transcribes it (recorded as such in the audit log).

import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

export type TextSource = "pdf-text-layer" | "none";

export interface ExtractedText {
  text: string | null;
  source: TextSource;
}

/** Below this many non-whitespace characters a PDF is treated as scanned. */
const MIN_TEXT_CHARS = 20;

export async function extractText(bytes: Uint8Array, mimeType: string): Promise<ExtractedText> {
  if (mimeType !== "application/pdf") return { text: null, source: "none" };

  // pdf.js may detach the buffer it is given, so pass a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractPdfText(pdf, { mergePages: true });
  const cleaned = text.replace(/[ \t]+\n/g, "\n").trim();

  if (cleaned.replace(/\s/g, "").length < MIN_TEXT_CHARS) return { text: null, source: "none" };
  return { text: cleaned, source: "pdf-text-layer" };
}
