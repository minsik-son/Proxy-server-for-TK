import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = { runtime: "edge" };

const VALID_LANGUAGES = [
  "ko", "en", "ja", "zh", "es", "fr", "de", "pt", "ru", "it",
];

const MAX_TEXT_LENGTH = 200;

const SYSTEM_PROMPT = (sourceLang: string, targetLang: string) =>
  `You are a professional translator. Translate the given text from ${sourceLang} to ${targetLang}. Output only the translated text without any explanations or additional text.`;

// ── Gemini (primary) ─────────────────────────────────

async function translateWithGemini(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("NO_GEMINI_KEY");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 512,
      // @ts-ignore
      thinkingConfig: { thinkingBudget: 0 },
    } as any,
  });

  const prompt = `${SYSTEM_PROMPT(sourceLang, targetLang)}\n\nText: ${text}`;
  const result = await model.generateContent(prompt);
  const translated = result.response.text().trim();

  if (!translated) throw new Error("Empty response from Gemini");
  return translated;
}

// ── OpenAI (fallback) ────────────────────────────────

async function translateWithOpenAI(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("NO_OPENAI_KEY");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT(sourceLang, targetLang) },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  const data = await res.json();
  const result = data.choices?.[0]?.message?.content?.trim();
  if (!result) throw new Error("Empty response from OpenAI");
  return result;
}

// ── Provider selection with fallback ─────────────────

async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<{ translatedText: string; engine: string }> {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (!hasGemini && !hasOpenAI) {
    throw new Error("No AI API key configured.");
  }

  // Try Gemini first (faster), fallback to OpenAI
  if (hasGemini) {
    try {
      const translated = await translateWithGemini(text, sourceLang, targetLang);
      return { translatedText: translated, engine: "gemini" };
    } catch (e) {
      console.warn("Gemini failed:", e);
      if (hasOpenAI) {
        const translated = await translateWithOpenAI(text, sourceLang, targetLang);
        return { translatedText: translated, engine: "openai" };
      }
      throw e;
    }
  }

  const translated = await translateWithOpenAI(text, sourceLang, targetLang);
  return { translatedText: translated, engine: "openai" };
}

// ── Edge Handler ─────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const body = await req.json();
    const { text, sourceLang, targetLang } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return Response.json({ error: "text is required" }, { status: 400, headers });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return Response.json(
        { error: `text exceeds maximum length of ${MAX_TEXT_LENGTH}` },
        { status: 400, headers }
      );
    }

    if (!sourceLang || !VALID_LANGUAGES.includes(sourceLang)) {
      return Response.json({ error: "Invalid sourceLang" }, { status: 400, headers });
    }

    if (!targetLang || !VALID_LANGUAGES.includes(targetLang)) {
      return Response.json({ error: "Invalid targetLang" }, { status: 400, headers });
    }

    const { translatedText, engine } = await translateText(
      text.trim(),
      sourceLang,
      targetLang
    );

    return Response.json(
      { translatedText, engine, charCount: text.length },
      { headers }
    );
  } catch (error) {
    console.error("Translation error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
