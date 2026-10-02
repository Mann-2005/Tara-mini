// Which model classifies documents. Configured via environment so a model
// retirement never requires a code change.

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * Default: gemini-3.8-flash (stable, has a free tier as of Oct 2026).
 * gemini-1.5-flash and gemini-2.0-flash are retired (2.0 shut down 2026-06-01).
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export function classificationModelId(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export function getClassificationModel(): LanguageModel {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set. Add it to .env (see .env.example).");
  }
  return createGoogleGenerativeAI({ apiKey })(classificationModelId());
}
