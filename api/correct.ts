import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
// import { checkRateLimit } from "../lib/rateLimiter";
// import { addUsage } from "../lib/usageTracker";

const VALID_LANGUAGES = [
  "ko", "en", "ja", "zh", "es", "fr", "de", "pt", "ru", "it",
];

const MAX_TEXT_LENGTH = 200;

const SYSTEM_PROMPT = (language: string) =>
  `You are a text correction assistant.\nFix spelling errors, typos, and grammar mistakes in the given text.\nKeep the meaning and style unchanged. Only return the corrected text with no explanation.\nIf the text has no errors, return it exactly as-is.\nLanguage: ${language}`;

// ── AI Provider Functions ──────────────────────────────

async function correctWithOpenAI(text: string, language: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("NO_OPENAI_KEY");

  const openai = new OpenAI({ apiKey });
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT(language) },
      { role: "user", content: text },
    ],
    temperature: 0.1,
    max_tokens: 500,
  });

  const result = response.choices[0]?.message?.content?.trim();
  if (!result) throw new Error("Empty response from OpenAI");
  return result;
}

async function correctWithGemini(text: string, language: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("NO_GEMINI_KEY");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
      // @ts-ignore - disable thinking for faster response
      thinkingConfig: { thinkingBudget: 0 },
    } as any,
  });

  const prompt = `${SYSTEM_PROMPT(language)}\n\nText: ${text}`;
  const result = await model.generateContent(prompt);
  const corrected = result.response.text().trim();

  if (!corrected) throw new Error("Empty response from Gemini");
  return corrected;
}

// ── Provider Selection ─────────────────────────────────

type Provider = "openai" | "gemini";

function getAvailableProviders(): Provider[] {
  const providers: Provider[] = [];
  if (process.env.OPENAI_API_KEY) providers.push("openai");
  if (process.env.GEMINI_API_KEY) providers.push("gemini");
  return providers;
}

async function correctText(text: string, language: string): Promise<{ correctedText: string; engine: string }> {
  const providers = getAvailableProviders();

  if (providers.length === 0) {
    throw new Error("No AI API key configured. Set OPENAI_API_KEY or GEMINI_API_KEY.");
  }

  // Primary: try first available provider
  // Fallback: if first fails and second exists, try second
  for (const provider of providers) {
    try {
      if (provider === "openai") {
        const corrected = await correctWithOpenAI(text, language);
        return { correctedText: corrected, engine: "openai" };
      } else {
        const corrected = await correctWithGemini(text, language);
        return { correctedText: corrected, engine: "gemini" };
      }
    } catch (error) {
      console.warn(`Provider ${provider} failed:`, error);
      // Continue to next provider if available
      continue;
    }
  }

  throw new Error("All AI providers failed");
}

// ── Handler ────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { text, language, tier, deviceId } = req.body;

    // Validate input
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    if (text.length > MAX_TEXT_LENGTH) {
      res
        .status(400)
        .json({ error: `text exceeds maximum length of ${MAX_TEXT_LENGTH}` });
      return;
    }

    if (!language || !VALID_LANGUAGES.includes(language)) {
      res.status(400).json({ error: "Invalid language" });
      return;
    }

    // tier and deviceId validation disabled for now

    // Call AI for correction (auto-selects available provider with fallback)
    const { correctedText, engine } = await correctText(text.trim(), language);

    // Usage tracking disabled for now
    // addUsage(deviceId, text.length).catch(() => {});

    res.status(200).json({ correctedText, engine });
  } catch (error) {
    console.error("Correction error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
