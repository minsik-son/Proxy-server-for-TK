import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = { runtime: "edge" };

const TONE_INSTRUCTIONS: Record<string, string> = {
  casual:
    "Write in casual, informal tone (반말 in Korean). Use relaxed endings like ~해, ~야.",
  formal:
    "Write in polite, formal tone (존댓말 in Korean). Use 해요체 or 합니다체.",
  polished:
    "Write in clean, well-structured style with proper punctuation.",
  friendly:
    "Write in warm, friendly tone. Be approachable and personable. Use emojis sparingly.",
};

const SYSTEM_PROMPT = (tone: string, language: string) =>
  `You are a message writing assistant.
Write a message based on the user's description.
${TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.casual}
Output ONLY the message itself, no explanations or quotes.
Language: ${language}`;

const MAX_PROMPT_LENGTH = 500;

// ── Gemini ──────────────────────────────────────────

async function composeWithGemini(
  prompt: string,
  tone: string,
  language: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("NO_GEMINI_KEY");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 512,
      // @ts-ignore
      thinkingConfig: { thinkingBudget: 0 },
    } as any,
  });

  const fullPrompt = `${SYSTEM_PROMPT(tone, language)}\n\nUser request: ${prompt}`;
  const result = await model.generateContent(fullPrompt);
  const message = result.response.text().trim();

  if (!message) throw new Error("Empty response from Gemini");
  return message;
}

// ── OpenAI (fallback) ───────────────────────────────

async function composeWithOpenAI(
  prompt: string,
  tone: string,
  language: string
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
        { role: "system", content: SYSTEM_PROMPT(tone, language) },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 512,
    }),
  });

  const data = await res.json();
  const result = data.choices?.[0]?.message?.content?.trim();
  if (!result) throw new Error("Empty response from OpenAI");
  return result;
}

// ── Provider selection with fallback ────────────────

async function composeMessage(
  prompt: string,
  tone: string,
  language: string
): Promise<{ message: string; engine: string }> {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (!hasGemini && !hasOpenAI) {
    throw new Error("No AI API key configured.");
  }

  if (hasGemini) {
    try {
      const message = await composeWithGemini(prompt, tone, language);
      return { message, engine: "gemini" };
    } catch (e) {
      console.warn("Gemini failed:", e);
      if (hasOpenAI) {
        const message = await composeWithOpenAI(prompt, tone, language);
        return { message, engine: "openai" };
      }
      throw e;
    }
  }

  const message = await composeWithOpenAI(prompt, tone, language);
  return { message, engine: "openai" };
}

// ── Edge Handler ────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
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
    const { prompt, tone, language } = body;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return Response.json(
        { error: "prompt is required" },
        { status: 400, headers }
      );
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return Response.json(
        { error: `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH}` },
        { status: 400, headers }
      );
    }

    const validTones = ["casual", "formal", "polished", "friendly"];
    const safeTone = validTones.includes(tone) ? tone : "casual";
    const safeLang = language || "ko";

    const { message, engine } = await composeMessage(
      prompt.trim(),
      safeTone,
      safeLang
    );

    return Response.json({ message, engine }, { headers });
  } catch (error) {
    console.error("Compose error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
