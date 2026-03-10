import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = { runtime: "edge" };

let _genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("NO_GEMINI_KEY");
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

const VALID_LANGUAGES = [
  "ko", "en", "ja", "zh", "es", "fr", "de", "pt", "ru", "it",
];

const MAX_TEXT_LENGTH = 200;

const TONE_INSTRUCTIONS: Record<string, string> = {
  none: "",
  casual:
    "\nConvert the text to casual/informal language (반말 in Korean). Use informal endings and relaxed tone (~해, ~야, ~거든). Do NOT add punctuation (commas, periods) that was not in the original text.",
  formal:
    "\nConvert the text to polite/formal language (존댓말 in Korean). Use 해요체 by default (~해요, ~이에요, ~하세요). If the context is clearly professional/business, use 합니다체 (~합니다, ~입니다). Do NOT add punctuation that was not in the original text.",
  polished:
    "\nKeep the original tone (반말/존댓말) exactly as-is, but properly insert all necessary punctuation marks: commas, periods, exclamation marks, question marks, etc. Ensure perfect spacing and clean sentence structure. This is a 'polished writing' mode — fix formatting and punctuation, not tone.",
};

const SYSTEM_PROMPT = (language: string, tone: string = "none") => {
  if (tone === "none" || !tone) {
    return `Fix spelling, typos, and spacing only. Do NOT add or remove punctuation. Return corrected text only. Language: ${language}`;
  }

  const toneInstruction = TONE_INSTRUCTIONS[tone] || "";
  return `Fix spelling/typos, then apply tone style.${toneInstruction} Return result only. Language: ${language}`;
};

// ── Gemini (primary) ─────────────────────────────────

async function correctWithGemini(
  text: string,
  language: string,
  tone: string
): Promise<string> {
  const model = getGenAI().getGenerativeModel({
    model: "gemini-3.1-flash-lite",
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

    const validTones = ["none", "casual", "formal", "polished"];
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
