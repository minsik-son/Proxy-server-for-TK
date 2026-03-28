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

// ── Reply Style Variations ──────────────────────────
// 3개 답장이 각각 다른 스타일을 가지도록 하는 variation 지시
const STYLE_VARIATIONS: string[] = [
  "STYLE: Write a SHORT and DIRECT reply. Get straight to the point in 1-2 sentences. Be concise — no filler words, no over-explanation. Prioritize clarity and brevity.",
  "STYLE: Write a WARM and DETAILED reply. Use 2-4 sentences with thoughtful elaboration. Show that you've fully understood the message. Add a personal touch or follow-up thought.",
  "STYLE: Write a CREATIVE and UNIQUE reply. Take an unexpected angle or use a fresh expression. Be memorable — try a different perspective, a light metaphor, or a clever observation. Keep it natural, not forced.",
];

// ── System Prompt ───────────────────────────────────
// v2: 언어 자동 감지 + 스타일 variation
const SYSTEM_PROMPT = (tone: string, context: string, styleVariation: string, direction?: string) => {
  let toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.casual;

  let base = `You are a chat reply assistant. Your task has TWO phases:\n\n`;

  // Phase 1: 언어 감지
  base += `PHASE 1 — LANGUAGE DETECTION:\n`;
  base += `First, detect the language of the ORIGINAL MESSAGE below. `;
  base += `Your reply MUST be written in the SAME language as the original message. `;
  base += `For example: if the message is in Korean, reply in Korean. If in English, reply in English. If in Japanese, reply in Japanese. `;
  base += `This is a strict requirement — NEVER reply in a different language than the original message.\n\n`;

  // Phase 1 보조: 한국어 톤 힌트
  base += `LANGUAGE-SPECIFIC RULES:\n`;
  base += `- If the message is in Korean and tone is "casual": Use 반말 (informal speech like ~해, ~야, ~거든)\n`;
  base += `- If the message is in Korean and tone is "formal": Use 존댓말 (polite speech like 해요체 or 합니다체)\n`;
  base += `- If the message is in Korean and tone is "empathetic": Maintain appropriate Korean emotional register\n`;
  base += `- If the message is in Japanese and tone is "casual": Use タメ口 (informal speech)\n`;
  base += `- If the message is in Japanese and tone is "formal": Use 敬語 (polite/honorific speech)\n`;
  base += `- For all other languages: Apply the tone naturally using that language's conventions\n\n`;

  // Phase 2: 답장 생성
  base += `PHASE 2 — REPLY GENERATION:\n`;
  base += `ORIGINAL MESSAGE TO REPLY TO: "${context}"\n`;
  base += `TONE: ${toneInstruction}\n`;
  base += `${styleVariation}\n`;

  if (direction && direction.trim().length > 0) {
    base += `USER DIRECTION: The user wants the reply to incorporate: ${direction}\n`;
  }

  base += `\nOutput the reply message only — no explanations, no labels, no quotes, no language tags.`;

  return base;
};

// ── Gemini ──────────────────────────────────────────
async function generateReplyWithGemini(
  context: string,
  tone: string,
  styleVariation: string,
  direction?: string
): Promise<string> {
  const model = getGenAI().getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 512,
      // @ts-ignore
      thinkingConfig: { thinkingBudget: 0 },
    } as any,
  });

  const userPrompt = direction && direction.trim().length > 0
    ? `Write a reply based on these instructions: ${direction}`
    : `Write a natural, appropriate reply to the message above.`;

  const fullPrompt = `${SYSTEM_PROMPT(tone, context, styleVariation, direction)}\n\n${userPrompt}`;
  const result = await model.generateContent(fullPrompt);
  const message = result.response.text().trim();

  if (!message) throw new Error("Empty response from Gemini");
  return message;
}

// ── OpenAI (fallback) ───────────────────────────────
async function generateReplyWithOpenAI(
  context: string,
  tone: string,
  styleVariation: string,
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
        { role: "system", content: SYSTEM_PROMPT(tone, context, styleVariation, direction) },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
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
  styleVariation: string,
  direction?: string
): Promise<string> {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (!hasGemini && !hasOpenAI) {
    throw new Error("No AI API key configured.");
  }

  if (hasGemini) {
    try {
      return await generateReplyWithGemini(context, tone, styleVariation, direction);
    } catch (e) {
      console.warn("Gemini failed:", e);
      if (hasOpenAI) {
        return await generateReplyWithOpenAI(context, tone, styleVariation, direction);
      }
      throw e;
    }
  }

  return await generateReplyWithOpenAI(context, tone, styleVariation, direction);
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
    const { context, tone, direction, count } = body;

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
    const safeDirection = typeof direction === "string" && direction.trim().length > 0
      ? direction.trim().slice(0, MAX_DIRECTION_LENGTH)
      : undefined;
    const safeCount = Math.min(Math.max(parseInt(count) || 3, 1), 3);

    // ── Generate replies with DIFFERENT style variations ──
    // 각 답장마다 다른 STYLE_VARIATIONS를 적용하여 다양한 답장 생성
    const promises = Array.from({ length: safeCount }, (_, index) => {
      const styleVariation = STYLE_VARIATIONS[index % STYLE_VARIATIONS.length];
      return generateReply(context.trim(), safeTone, styleVariation, safeDirection);
    });

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
  } catch (error) {
    console.error("Chat reply generation error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
