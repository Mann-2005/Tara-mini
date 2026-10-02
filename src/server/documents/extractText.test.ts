import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractText } from "./extractText";

async function pdfWithText(lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 20, size: 12, font }));
  return pdf.save();
}

describe("extractText", () => {
  it("reads the text layer of a digital PDF, including umlauts", async () => {
    const bytes = await pdfWithText(["Baustoffhandel Krämer GmbH", "Rechnungsdatum: 10.09.2026", "Gesamtbetrag: 8.925,00 EUR"]);
    const result = await extractText(bytes, "application/pdf");
    expect(result.source).toBe("pdf-text-layer");
    expect(result.text).toContain("Krämer");
    expect(result.text).toContain("8.925,00");
  });

  it("treats a PDF without text (e.g. a scan) as having no text layer", async () => {
    const result = await extractText(await pdfWithText([]), "application/pdf");
    expect(result).toEqual({ text: null, source: "none" });
  });

  it("returns no text for images (the model transcribes them)", async () => {
    expect(await extractText(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png")).toEqual({ text: null, source: "none" });
  });
});
