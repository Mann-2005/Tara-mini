import { describe, expect, it } from "vitest";
import { buildVoucher, type EigenbelegInput } from "@/domain/eigenbeleg/eigenbeleg";
import { extractText } from "../documents/extractText";
import { renderVoucherPdf, toWinAnsi } from "./renderVoucherPdf";

const INPUT: EigenbelegInput = {
  client: { name: "Weber Bau GmbH", clientNumber: "10003" },
  period: { start: "2026-09-01", end: "2026-09-30", label: "Eingangsrechnungen September 2026" },
  expenseDate: "2026-09-03",
  payee: "Telefónica Germany GmbH & Co. OHG",
  description: "O2 Business Mobilfunk, September 2026 — Diensthandy 📱",
  grossAmount: "47.60",
  reason: "LOST",
  reasonDetail: "",
  businessPurpose: "Diensthandy des Bauleiters für die Kommunikation mit Subunternehmern auf der Baustelle Essen-Rüttenscheid, Abrechnung über das Firmenkonto",
  digitallyConfirmedBy: null,
  createdBy: "staff:demo",
  createdOn: "2026-10-04",
};

describe("toWinAnsi", () => {
  it("keeps German characters, € and typographic dashes; replaces what the PDF fonts cannot draw", () => {
    expect(toWinAnsi("Größe für Bäcker – 47,60 € „gut“")).toBe("Größe für Bäcker – 47,60 € „gut“");
    expect(toWinAnsi("Handy 📱\tok")).toBe("Handy ? ok");
  });
});

describe("renderVoucherPdf", () => {
  it("produces a PDF whose text contains the statutory content", async () => {
    const voucher = buildVoucher(INPUT, "EB-10003-0001");
    const bytes = await renderVoucherPdf(voucher, new Date("2026-10-04T09:00:00Z"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    const { text } = await extractText(bytes, "application/pdf");
    for (const expected of ["Eigenbeleg (Ersatzbeleg)", "Nr. EB-10003-0001", "Telefónica Germany GmbH & Co. OHG", "47,60 EUR", "Davon Vorsteuer", "§ 15 Abs. 1 Nr. 1 UStG", "Unterschrift des Zahlenden", "Rüttenscheid"]) {
      expect(text).toContain(expected);
    }
    expect(text).toContain("Diensthandy ?"); // emoji replaced, not crashed
  });

  it("prints the digital confirmation instead of a signature line", async () => {
    const bytes = await renderVoucherPdf(buildVoucher({ ...INPUT, digitallyConfirmedBy: "Klaus Weber" }, "EB-10003-0002"), new Date("2026-10-04T09:00:00Z"));
    const { text } = await extractText(bytes, "application/pdf");
    expect(text).toContain("Digital bestätigt durch: Klaus Weber");
    expect(text).not.toContain("Unterschrift des Zahlenden");
  });

  it("is reproducible: same voucher and timestamp give identical bytes", async () => {
    const v = buildVoucher(INPUT, "EB-10003-0001");
    const at = new Date("2026-10-04T09:00:00Z");
    expect(Buffer.from(await renderVoucherPdf(v, at)).equals(Buffer.from(await renderVoucherPdf(v, at)))).toBe(true);
  });
});
