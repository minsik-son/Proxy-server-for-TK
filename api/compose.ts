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

// 한국어 전용 톤 보조 지시 — language가 "ko"일 때만 적용
const KOREAN_TONE_HINTS: Record<string, string> = {
  casual: "Use 반말 (informal Korean speech). Use relaxed endings like ~해, ~야.",
  formal: "Use 존댓말 (polite Korean speech). Use 해요체 or 합니다체.",
  empathetic: "Maintain appropriate Korean emotional register.",
};

const LENGTH_INSTRUCTIONS: Record<string, string> = {
  short: "Keep the response to 1-2 sentences maximum.",
  medium: "Write 3-4 sentences, providing adequate detail.",
  long: "Write a full paragraph with comprehensive detail.",
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

const SYSTEM_PROMPT = (tone: string, language: string, length: string, replyContext?: string) => {
  const isAutoDetect = language === "auto";
  const langName = isAutoDetect ? null : (LANGUAGE_NAMES[language] || language);

  // 톤 기본 지시
  let toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.casual;

  // 한국어가 명시적으로 지정된 경우에만 한국어 톤 보조 힌트 추가
  if (language === "ko" && KOREAN_TONE_HINTS[tone]) {
    toneInstruction += " " + KOREAN_TONE_HINTS[tone];
  }

  const lengthInstruction = LENGTH_INSTRUCTIONS[length] || LENGTH_INSTRUCTIONS.medium;

  let base = `You are a message composer. Write a message based on the user's description.\n\n`;
  base += `TONE: ${toneInstruction}\n`;
  base += `LENGTH: ${lengthInstruction}\n`;

  if (isAutoDetect) {
    // ── 자동 감지 모드 (PRIMARY LANGUAGE 방식 — chat-reply 엔드포인트와 일관된 접근) ──
    base += `OUTPUT LANGUAGE (AUTO-DETECT MODE):\n`;
    base += `Detect the PRIMARY language of the user's input text and reply context (if provided) by analyzing the OVERALL sentence structure and grammar, NOT individual words or proper nouns.\n`;
    base += `Write your entire response in the detected primary language.\n\n`;
    base += `Language detection rules:\n`;
    base += `- Analyze the grammatical structure of the input to determine the primary language.\n`;
    base += `- Proper nouns, brand names, technical terms, or loanwords do NOT indicate language. Example: "Tesla Y 보험 갱신" is Korean despite containing English words.\n`;
    base += `- If a reply context is provided and the user's input is very short (1-3 words) or ambiguous, prioritize the reply context's language.\n`;
    base += `- If no reply context and the input is ambiguous, default to English.\n`;
    base += `- NEVER mix languages in your response. Write entirely in one detected language.\n\n`;
    base += `Supported languages for detection: Korean, English, Japanese, Simplified Chinese, Traditional Chinese, Vietnamese, Thai, Indonesian, Spanish, French, German, Portuguese, Russian, Italian.\n\n`;

    // 자동 감지 시 한국어로 감지되면 톤 힌트 적용 지시
    if (KOREAN_TONE_HINTS[tone]) {
      base += `Special rule: If the detected language is Korean, apply these additional tone rules: ${KOREAN_TONE_HINTS[tone]}\n\n`;
    }
  } else {
    // ── 명시적 언어 지정 모드: 기존 강제 지시 유지 ──
    base += `OUTPUT LANGUAGE: You MUST write your entire response in ${langName}. Even if the user's input is in a different language, your output MUST be in ${langName}. This is a strict requirement.\n`;
  }

  base += `Output the composed message only — no explanations, no labels, no quotes.`;

  if (replyContext) {
    base += `\n\nThe user is replying to this message: "${replyContext}"\nWrite an appropriate reply based on the user's instructions.`;
  }

  return base;
};

const MAX_PROMPT_LENGTH = 500;

// ── Gemini ──────────────────────────────────────────

async function composeWithGemini(
  prompt: string,
  tone: string,
  language: string,
  length: string,
  replyContext?: string
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

  const fullPrompt = `${SYSTEM_PROMPT(tone, language, length, replyContext)}\n\nUser request: ${prompt}`;
  const result = await model.generateContent(fullPrompt);
  const message = result.response.text().trim();

  if (!message) throw new Error("Empty response from Gemini");
  return message;
}

// ── OpenAI (fallback) ───────────────────────────────

async function composeWithOpenAI(
  prompt: string,
  tone: string,
  language: string,
  length: string,
  replyContext?: string
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
        { role: "system", content: SYSTEM_PROMPT(tone, language, length, replyContext) },
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
  language: string,
  length: string,
  replyContext?: string
): Promise<{ message: string; engine: string }> {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (!hasGemini && !hasOpenAI) {
    throw new Error("No AI API key configured.");
  }

  if (hasGemini) {
    try {
      const message = await composeWithGemini(prompt, tone, language, length, replyContext);
      return { message, engine: "gemini" };
    } catch (e) {
      console.warn("Gemini failed:", e);
      if (hasOpenAI) {
        const message = await composeWithOpenAI(prompt, tone, language, length, replyContext);
        return { message, engine: "openai" };
      }
      throw e;
    }
  }

  const message = await composeWithOpenAI(prompt, tone, language, length, replyContext);
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
    const { prompt, tone, language, length, replyContext, count } = body;

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

    const validTones = [
      "casual", "formal", "polished", "friendly",
      "empathetic", "confident", "witty", "persuasive",
      "enthusiastic", "apologetic", "social", "professional"
    ];
    const safeTone = validTones.includes(tone) ? tone : "casual";
    const validLanguages = ["auto", "ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "es", "fr", "de", "pt", "id", "ru"];
    const safeLang = validLanguages.includes(language) ? language : "auto";

    const validLengths = ["short", "medium", "long"];
    const safeLength = validLengths.includes(length) ? length : "medium";
    const safeReplyContext = typeof replyContext === "string" && replyContext.trim().length > 0
      ? replyContext.trim().slice(0, 1000)
      : undefined;

    // [v2-C6] Server-side count validation
    // TODO: When auth is implemented, check user tier here
    const safeCount = Math.min(Math.max(parseInt(count) || 1, 1), 3);

    if (safeCount > 1) {
      // [v2-W5] Use allSettled for partial results
      const promises = Array.from({ length: safeCount }, () =>
        composeMessage(prompt.trim(), safeTone, safeLang, safeLength, safeReplyContext)
      );
      const settled = await Promise.allSettled(promises);
      const fulfilled = settled
        .filter((r): r is PromiseFulfilledResult<{ message: string; engine: string }> => r.status === "fulfilled")
        .map(r => r.value);

      if (fulfilled.length === 0) {
        return Response.json({ error: "All generation attempts failed" }, { status: 500, headers });
      }

      // [v2-C3] Always include BOTH message (first result) AND messages (all results)
      return Response.json({
        message: fulfilled[0].message,
        messages: fulfilled.map(r => r.message),
        engine: fulfilled[0].engine,
      }, { headers });
    }

    // Single result (count=1)
    const { message, engine } = await composeMessage(
      prompt.trim(), safeTone, safeLang, safeLength, safeReplyContext
    );

    // [v2-C3] Always include both fields
    return Response.json({ message, messages: [message], engine }, { headers });
  } catch (error) {
    console.error("Compose error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
