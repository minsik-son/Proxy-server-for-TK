import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = { runtime: "edge" };

// ── Singleton ───────────────────────────────────────
let _genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("NO_GEMINI_KEY");
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

// ── Tone Instructions ───────────────────────────────
// compose.ts와 동일한 톤 맵 사용
const TONE_INSTRUCTIONS: Record<string, string> = {
  casual:
    "Write in casual, informal tone. Use relaxed, conversational language.",
  formal:
    "Write in polite, formal tone. Use respectful and professional language.",
  polished:
    "Write in clean, well-structured style with proper punctuation.",
  friendly:
    "Write in warm, friendly tone. Be approachable and personable. Use emojis sparingly.",
  empathetic:
    "Write with warmth and emotional understanding. Show genuine care, empathy, and compassion.",
  confident:
    "Write with assertiveness and authority. Be direct, decisive, and self-assured without being arrogant.",
  witty:
    "Write with clever humor and wordplay. Be entertaining and sharp but keep the core message clear.",
  persuasive:
    "Write to convince and influence. Use logical arguments, compelling language, and strategic framing.",
  enthusiastic:
    "Write with energy, excitement, and positivity. Express genuine enthusiasm. Use exclamation marks sparingly but effectively.",
  apologetic:
    "Write with sincerity and remorse. Acknowledge the issue, take responsibility, and express willingness to make things right.",
  social:
    "Write in trendy, casual social media style. Use Gen-Z language patterns, appropriate emojis, abbreviations, and hashtag-ready phrasing.",
  professional:
    "Write with competence and strategic authority. Imply expertise and thought leadership. Distinct from formal — focus on substance over politeness.",
};

const KOREAN_TONE_HINTS: Record<string, string> = {
  casual: "Use 반말 (informal Korean speech). Use relaxed endings like ~해, ~야.",
  formal: "Use 존댓말 (polite Korean speech). Use 해요체 or 합니다체.",
  empathetic: "Maintain appropriate Korean emotional register.",
};

const LANGUAGE_NAMES: Record<string, string> = {
  ko: "Korean",
  en: "English",
  ja: "Japanese",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  vi: "Vietnamese",
  th: "Thai",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  id: "Indonesian",
  ru: "Russian",
};

// ── System Prompt ───────────────────────────────────
// chat-reply 전용: context(원본 메시지)에 대한 답장 생성에 최적화
const SYSTEM_PROMPT = (tone: string, language: string, context: string, direction?: string) => {
  const langName = LANGUAGE_NAMES[language] || language;

  let toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.casual;

  if (language === "ko" && KOREAN_TONE_HINTS[tone]) {
    toneInstruction += " " + KOREAN_TONE_HINTS[tone];
  }

  let base = `You are a chat reply assistant. Generate a natural reply to the given message.\n\n`;
  base += `ORIGINAL MESSAGE TO REPLY TO: "${context}"\n`;
  base += `TONE: ${toneInstruction}\n`;
  base += `LENGTH: Keep the reply to 1-3 sentences. Be concise and natural.\n`;
  base += `OUTPUT LANGUAGE: You MUST write your entire response in ${langName}. Even if the original message is in a different language, your output MUST be in ${langName}. This is a strict requirement.\n`;

  if (direction && direction.trim().length > 0) {
    base += `USER DIRECTION: The user wants the reply to: ${direction}\n`;
  }

  base += `Output the reply message only — no explanations, no labels, no quotes.`;

  return base;
};

// ── Gemini ──────────────────────────────────────────
async function generateReplyWithGemini(
  context: string,
  tone: string,
  language: string,
  direction?: string
): Promise<string> {
  const model = getGenAI().getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 512,
      // @ts-ignore
      thinkingConfig: { thinkingBudget: 0 },
    } as any,
  });

  const prompt = direction && direction.trim().length > 0
    ? `Write a reply based on these instructions: ${direction}`
    : `Write a natural, appropriate reply to the message above.`;

  const fullPrompt = `${SYSTEM_PROMPT(tone, language, context, direction)}\n\n${prompt}`;
  const result = await model.generateContent(fullPrompt);
  const message = result.response.text().trim();

  if (!message) throw new Error("Empty response from Gemini");
  return message;
}

// ── OpenAI (fallback) ───────────────────────────────
async function generateReplyWithOpenAI(
  context: string,
  tone: string,
  language: string,
  direction?: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("NO_OPENAI_KEY");

  const userPrompt = direction && direction.trim().length > 0
    ? `Write a reply based on these instructions: ${direction}`
    : `Write a natural, appropriate reply to the message above.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT(tone, language, context, direction) },
        { role: "user", content: userPrompt },
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
async function generateReply(
  context: string,
  tone: string,
  language: string,
  direction?: string
): Promise<string> {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (!hasGemini && !hasOpenAI) {
    throw new Error("No AI API key configured.");
  }

  if (hasGemini) {
    try {
      return await generateReplyWithGemini(context, tone, language, direction);
    } catch (e) {
      console.warn("Gemini failed:", e);
      if (hasOpenAI) {
        return await generateReplyWithOpenAI(context, tone, language, direction);
      }
      throw e;
    }
  }

  return await generateReplyWithOpenAI(context, tone, language, direction);
}

// ── Validation Constants ────────────────────────────
const MAX_CONTEXT_LENGTH = 1000;
const MAX_DIRECTION_LENGTH = 500;
const VALID_TONES = [
  "casual", "formal", "polished", "friendly",
  "empathetic", "confident", "witty", "persuasive",
  "enthusiastic", "apologetic", "social", "professional"
];

// ── Edge Handler ────────────────────────────────────
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

    // 앱이 보내는 필드: context, tone, direction, language, count, deviceId
    const { context, tone, direction, language, count } = body;

    // ── Validation ────────────────────────────────
    if (!context || typeof context !== "string" || context.trim().length === 0) {
      return Response.json(
        { error: "context is required" },
        { status: 400, headers }
      );
    }

    if (context.length > MAX_CONTEXT_LENGTH) {
      return Response.json(
        { error: `context exceeds maximum length of ${MAX_CONTEXT_LENGTH}` },
        { status: 400, headers }
      );
    }

    const safeTone = VALID_TONES.includes(tone) ? tone : "casual";
    const safeLang = language || "en";
    const safeDirection = typeof direction === "string" && direction.trim().length > 0
      ? direction.trim().slice(0, MAX_DIRECTION_LENGTH)
      : undefined;
    const safeCount = Math.min(Math.max(parseInt(count) || 3, 1), 3);

    // ── Generate replies ──────────────────────────
    if (safeCount > 1) {
      const promises = Array.from({ length: safeCount }, () =>
        generateReply(context.trim(), safeTone, safeLang, safeDirection)
      );
      const settled = await Promise.allSettled(promises);
      const fulfilled = settled
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
        .map(r => r.value);

      if (fulfilled.length === 0) {
        return Response.json(
          { error: "All generation attempts failed" },
          { status: 500, headers }
        );
      }

      // 앱이 기대하는 응답 형식: { replies: [String] }
      return Response.json({ replies: fulfilled }, { headers });
    }

    // Single result
    const reply = await generateReply(
      context.trim(), safeTone, safeLang, safeDirection
    );

    return Response.json({ replies: [reply] }, { headers });
  } catch (error) {
    console.error("Chat reply generation error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
