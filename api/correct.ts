import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = { runtime: "edge" };

const VALID_LANGUAGES = [
  "ko", "en", "ja", "zh", "es", "fr", "de", "pt", "ru", "it",
];

const MAX_TEXT_LENGTH = 200;

const TONE_INSTRUCTIONS: Record<string, string> = {
  none: "",
  formal:
    "\nConvert the text to formal/polite language (존댓말/격식체 in Korean). Use honorifics and polite endings.",
  casual:
    "\nConvert the text to casual/informal language (반말 in Korean). Use informal endings and relaxed tone.",
  business:
    "\nConvert the text to professional business tone. Use formal but concise language suitable for workplace communication.",
  friendly:
    "\nConvert the text to a warm, friendly tone. Make it sound approachable and personable while keeping it natural.",
};

const SYSTEM_PROMPT = (language: string, tone: string = "none") => {
  if (tone === "none" || !tone) {
    return `You are a text correction assistant.\nFix spelling errors, typos, and grammar mistakes in the given text.\nKeep the meaning and style unchanged. Only return the corrected text with no explanation.\nIf the text has no errors, return it exactly as-is.\nLanguage: ${language}`;
  }

  const toneInstruction = TONE_INSTRUCTIONS[tone] || "";
  return `You are a text correction and style conversion assistant.\nFirst, fix any spelling errors, typos, and grammar mistakes in the given text.\nThen, convert the corrected text to the specified tone/style.${toneInstruction}\nOnly return the final result with no explanation.\nKeep the original meaning intact.\nLanguage: ${language}`;
};

// ── Gemini (primary) ─────────────────────────────────

async function correctWithGemini(
  text: string,
  language: string,
  tone: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("NO_GEMINI_KEY");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
      // @ts-ignore
      thinkingConfig: { thinkingBudget: 0 },
    } as any,
  });

  const prompt = `${SYSTEM_PROMPT(language, tone)}\n\nText: ${text}`;
  const result = await model.generateContent(prompt);
  const corrected = result.response.text().trim();

  if (!corrected) throw new Error("Empty response from Gemini");
  return corrected;
}

// ── OpenAI (fallback) ────────────────────────────────

async function correctWithOpenAI(
  text: string,
  language: string,
  tone: string
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
        { role: "system", content: SYSTEM_PROMPT(language, tone) },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  const data = await res.json();
  const result = data.choices?.[0]?.message?.content?.trim();
  if (!result) throw new Error("Empty response from OpenAI");
  return result;
}

// ── Provider selection with fallback ─────────────────

async function correctText(
  text: string,
  language: string,
  tone: string
): Promise<{ correctedText: string; engine: string }> {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (!hasGemini && !hasOpenAI) {
    throw new Error("No AI API key configured.");
  }

  // Try Gemini first (faster), fallback to OpenAI
  if (hasGemini) {
    try {
      const corrected = await correctWithGemini(text, language, tone);
      return { correctedText: corrected, engine: "gemini" };
    } catch (e) {
      console.warn("Gemini failed:", e);
      if (hasOpenAI) {
        const corrected = await correctWithOpenAI(text, language, tone);
        return { correctedText: corrected, engine: "openai" };
      }
      throw e;
    }
  }

  const corrected = await correctWithOpenAI(text, language, tone);
  return { correctedText: corrected, engine: "openai" };
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
    const { text, language, tone } = body;

    const validTones = ["none", "formal", "casual", "business", "friendly"];
    const safeTone = validTones.includes(tone) ? tone : "none";

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return Response.json({ error: "text is required" }, { status: 400, headers });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return Response.json(
        { error: `text exceeds maximum length of ${MAX_TEXT_LENGTH}` },
        { status: 400, headers }
      );
    }

    if (!language || !VALID_LANGUAGES.includes(language)) {
      return Response.json({ error: "Invalid language" }, { status: 400, headers });
    }

    const { correctedText, engine } = await correctText(
      text.trim(),
      language,
      safeTone
    );

    return Response.json({ correctedText, engine }, { headers });
  } catch (error) {
    console.error("Correction error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
