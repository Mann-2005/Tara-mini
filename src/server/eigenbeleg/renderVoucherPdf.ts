// Renders an Eigenbeleg voucher as a printable A4 PDF (pdf-lib, no network).
// The content comes from the pure buildVoucher(); this file only lays it out.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { Voucher } from "@/domain/eigenbeleg/eigenbeleg";

// TARA brand ink and green.
const INK = rgb(0, 0.161, 0.063); // #002910
const MUTED = rgb(0.318, 0.427, 0.357); // #516d5b
const BRAND = rgb(0, 0.239, 0.094); // #003d18
const RULE = rgb(0.804, 0.824, 0.8); // #cdd2cc

/** Characters outside WinAnsi (e.g. emoji) cannot be drawn with the standard fonts. */
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function toWinAnsi(text: string): string {
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (ch === "\t") return " ";
      if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) return ch;
      return "?";
    })
    .join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of toWinAnsi(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || line === "") line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderVoucherPdf(voucher: Voucher, createdAt: Date): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${voucher.title} ${voucher.number}`);
  pdf.setProducer("Tara Mini");
  pdf.setCreator("Tara Mini Eigenbeleg-Generator");
  pdf.setCreationDate(createdAt);
  pdf.setModificationDate(createdAt);

  const page: PDFPage = pdf.addPage([595.28, 841.89]); // A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const left = 56;
  const right = 595.28 - 56;
  let y = 780;

  const text = (s: string, x: number, size: number, font: PDFFont, color = INK) => page.drawText(toWinAnsi(s), { x, y, size, font, color });

  // Header: title and number, brand rule underneath.
  text(voucher.title, left, 18, bold, BRAND);
  const numberLabel = `Nr. ${voucher.number}`;
  text(numberLabel, right - bold.widthOfTextAtSize(toWinAnsi(numberLabel), 11), 11, bold);
  y -= 14;
  page.drawRectangle({ x: left, y, width: right - left, height: 2, color: BRAND });
  y -= 26;

  // Fields: label column + wrapped value column.
  const labelWidth = 170;
  for (const [label, value] of voucher.fields) {
    const lines = wrap(value, regular, 10.5, right - left - labelWidth);
    text(label, left, 9, regular, MUTED);
    for (const line of lines) {
      text(line, left + labelWidth, 10.5, regular);
      y -= 15;
    }
    y -= 5;
    page.drawLine({ start: { x: left, y: y + 9 }, end: { x: right, y: y + 9 }, thickness: 0.5, color: RULE });
  }

  // VAT note in a box.
  y -= 10;
  const noteLines = wrap(voucher.vatNote, regular, 9.5, right - left - 20);
  const boxHeight = noteLines.length * 13 + 16;
  page.drawRectangle({ x: left, y: y - boxHeight + 12, width: right - left, height: boxHeight, borderColor: BRAND, borderWidth: 1 });
  y -= 2;
  for (const line of noteLines) {
    text(line, left + 10, 9.5, regular);
    y -= 13;
  }
  y -= 26;

  // Declaration and signature.
  for (const line of wrap(voucher.declaration, regular, 10, right - left)) {
    text(line, left, 10, regular);
    y -= 14;
  }
  y -= 36;
  if (voucher.signature.mode === "DIGITAL") {
    text(`Digital bestätigt durch: ${voucher.signature.confirmedBy}`, left, 10.5, bold);
  } else {
    page.drawLine({ start: { x: left, y }, end: { x: left + 220, y }, thickness: 0.8, color: INK });
    page.drawLine({ start: { x: right - 220, y }, end: { x: right, y }, thickness: 0.8, color: INK });
    y -= 12;
    text("Ort, Datum", left, 8.5, regular, MUTED);
    text("Unterschrift des Zahlenden", right - 220, 8.5, regular, MUTED);
  }

  // Footer.
  y = 50;
  for (const line of wrap(voucher.footer, regular, 8, right - left)) {
    text(line, left, 8, regular, MUTED);
    y -= 11;
  }

  return pdf.save();
}
