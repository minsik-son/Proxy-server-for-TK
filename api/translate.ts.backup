import type { VercelRequest, VercelResponse } from "@vercel/node";
// import { checkRateLimit } from "../lib/rateLimiter";
// import { addUsage } from "../lib/usageTracker";
import { routeTranslation } from "../lib/engineRouter";

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
    const { text, sourceLang, targetLang, tier } = req.body;

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

    if (!sourceLang || !VALID_LANGUAGES.includes(sourceLang)) {
      res.status(400).json({ error: "Invalid sourceLang" });
      return;
    }

    if (!targetLang || !VALID_LANGUAGES.includes(targetLang)) {
      res.status(400).json({ error: "Invalid targetLang" });
      return;
    }

    // Route and translate
    const { translatedText, engine } = await routeTranslation(
      text,
      sourceLang,
      targetLang,
      tier || "free",
      0
    );

    res.status(200).json({
      translatedText,
      engine,
      charCount: text.length,
    });
  } catch (error) {
    console.error("Translation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
