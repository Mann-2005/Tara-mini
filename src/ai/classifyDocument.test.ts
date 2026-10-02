import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { classifyDocument, type ClassifyInput } from "./classifyDocument";

/** A mock model that answers with the given JSON text. */
function mockModel(answer: unknown) {
  return new MockLanguageModelV4({
    modelId: "mock-gemini",
    doGenerate: {
      content: [{ type: "text", text: typeof answer === "string" ? answer : JSON.stringify(answer) }],
      finishReason: { unified: "stop", raw: "STOP" },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 50, text: 50, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

const VALID = {
  documentType: "INCOMING_INVOICE",
  documentDate: "2026-09-10",
  amount: 8925,
  vatAmount: 1425,
  currency: "EUR",
  counterparty: "Baustoffhandel Krämer GmbH",
  confidence: 0.91,
};

const textInput: ClassifyInput = {
  clientName: "Weber Bau GmbH",
  filename: "Rechnung.pdf",
  text: "Baustoffhandel Krämer GmbH\nRechnung Nr. 4711\nRechnungsdatum: 10.09.2026\nGesamtbetrag: 8.925,00 EUR",
  file: { data: new Uint8Array([1, 2, 3]), mediaType: "application/pdf" },
};

describe("classifyDocument", () => {
  it("returns a schema-valid proposal", async () => {
    const result = await classifyDocument(textInput, mockModel(VALID));
    expect(result).toEqual({ proposal: VALID, transcribedText: null });
  });

  it("sends the extracted text and the client name, not the file, when text exists", async () => {
    const model = mockModel(VALID);
    await classifyDocument(textInput, model);
    const call = model.doGenerateCalls[0];
    const prompt = JSON.stringify(call.prompt);
    expect(prompt).toContain("Weber Bau GmbH");
    expect(prompt).toContain("Rechnungsdatum: 10.09.2026");
    expect(prompt).not.toContain('"type":"file"');
    expect(call.responseFormat).toMatchObject({ type: "json" }); // structured output requested
    expect(call.temperature).toBe(0);
  });

  it("sends the file and asks for a transcription when there is no text layer", async () => {
    const model = mockModel({ ...VALID, documentType: "RECEIPT", transcribedText: "Kassenbon\nSumme 12,50" });
    const result = await classifyDocument({ ...textInput, text: null, file: { data: new Uint8Array([9]), mediaType: "image/jpeg" } }, model);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain('"type":"file"');
    expect(result.transcribedText).toBe("Kassenbon\nSumme 12,50");
    expect(result.proposal).not.toHaveProperty("transcribedText");
  });

  it.each([
    ["an unknown document type", { ...VALID, documentType: "INVOICE" }],
    ["a German-format date", { ...VALID, documentDate: "10.09.2026" }],
    ["an impossible date", { ...VALID, documentDate: "2026-02-30" }],
    ["confidence above 1", { ...VALID, confidence: 1.4 }],
    ["a lowercase currency", { ...VALID, currency: "eur" }],
    ["an extra field", { ...VALID, iban: "DE00 0000" }],
    ["a missing field", { documentType: "OTHER" }],
    ["text that is not JSON", "This looks like an invoice from Krämer."],
  ])("rejects %s", async (_label, answer) => {
    await expect(classifyDocument(textInput, mockModel(answer))).rejects.toThrow();
  });
});
