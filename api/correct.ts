import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { checkRateLimit } from "../lib/rateLimiter";
import { getUsage, addUsage } from "../lib/usageTracker";

const VALID_LANGUAGES = [
  "ko", "en", "ja", "zh", "es", "fr", "de", "pt", "ru", "it",
];

const MAX_TEXT_LENGTH = 200;

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

    if (!tier || (tier !== "free" && tier !== "pro")) {
      res.status(400).json({ error: "tier must be 'free' or 'pro'" });
      return;
    }

    if (!deviceId || typeof deviceId !== "string") {
      res.status(400).json({ error: "deviceId is required" });
      return;
    }

    // Rate limit check
    const rateLimitResult = checkRateLimit(deviceId, tier);
    if (!rateLimitResult.allowed) {
      res.status(429).json({
        error: "Rate limit exceeded",
        retryAfter: rateLimitResult.retryAfter,
      });
      return;
    }

    // Usage tracking
    await getUsage(deviceId);

    // Call GPT-4o-mini for correction
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY");
    }

    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a text correction assistant.\nFix spelling errors, typos, and grammar mistakes in the given text.\nKeep the meaning and style unchanged. Only return the corrected text with no explanation.\nIf the text has no errors, return it exactly as-is.\nLanguage: ${language}`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const correctedText = response.choices[0]?.message?.content?.trim();
    if (!correctedText) {
      throw new Error("Empty response from GPT");
    }

    const charCount = text.length;
    await addUsage(deviceId, charCount);

    res.status(200).json({ correctedText });
  } catch (error) {
    console.error("Correction error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
