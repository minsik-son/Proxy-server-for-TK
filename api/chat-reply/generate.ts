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
  polite:
    "Write in polite, courteous tone. Show respect and consideration. Use please, thank you, and other polite expressions naturally.",
  cool:
    "Write in cool, laid-back tone. Be effortlessly smooth and collected. Don't try too hard — let the style flow naturally.",
  romantic:
    "Write with warmth, affection, and romantic undertones. Be tender and emotionally expressive without being over-the-top.",
  direct:
    "Write with clarity and directness. Get straight to the point. No fluff, no hedging — say exactly what you mean.",
  thoughtful:
    "Write with depth and reflection. Show careful consideration of the topic. Be measured, nuanced, and contemplative.",
};

// ── v3.4 톤 매핑: iOS → Server ─────────────────────
// iOS toneAPIValues: ["Friendly", "Polite", "Cool", "Witty", "Professional", "Romantic", "Direct", "Thoughtful"]
// 대소문자 통일 + 누락 톤 매핑
const TONE_ALIAS_MAP: Record<string, string> = {
  friendly: "friendly",
  polite: "polite",
  cool: "cool",
  witty: "witty",
  professional: "professional",
  romantic: "romantic",
  direct: "direct",
  thoughtful: "thoughtful",
  // 기존 compose.ts 호환
  casual: "casual",
  formal: "formal",
  polished: "polished",
  empathetic: "empathetic",
  confident: "confident",
  persuasive: "persuasive",
  enthusiastic: "enthusiastic",
  apologetic: "apologetic",
  social: "social",
};

// ── Reply Style Variations ──────────────────────────
const STYLE_VARIATIONS: string[] = [
  "STYLE: Write a SHORT and DIRECT reply. Get straight to the point in 1-2 sentences. Be concise — no filler words, no over-explanation. Prioritize clarity and brevity.",
  "STYLE: Write a WARM and DETAILED reply. Use 2-4 sentences with thoughtful elaboration. Show that you've fully understood the message. Add a personal touch or follow-up thought.",
  "STYLE: Write a CREATIVE and UNIQUE reply. Take an unexpected angle or use a fresh expression. Be memorable — try a different perspective, a light metaphor, or a clever observation. Keep it natural, not forced. IMPORTANT: Creativity applies ONLY to content and expression. You MUST still reply in the SAME language as the original message. Do NOT switch languages for creative effect.",
];

// ── System Prompt ───────────────────────────────────
// v3.2: context를 시스템 프롬프트에서 제거 → 프롬프트 인젝션 방지
const SYSTEM_PROMPT = (tone: string, styleVariation: string, direction?: string) => {
  let toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.casual;

  let base = `You are a ghostwriter composing a chat reply on behalf of a real person. You are NOT an AI, NOT a chatbot, NOT an assistant, NOT a language model. You are writing AS the person who received this message. The person will send your reply as their own.\n\n`;

  // 절대 금지 사항
  base += `IDENTITY RULES (STRICTLY ENFORCED — applies to ALL styles including CREATIVE):\n`;
  base += `- NEVER reveal or hint that you are an AI, bot, chatbot, language model, assistant, or any non-human entity.\n`;
  base += `- NEVER use phrases like: "I'm an AI", "As an AI", "I'm a language model", "I'm a chatbot", "I'm an assistant", "I'm a bot", "I'm not a real person", "I don't actually exist", "I don't have feelings", "I can't feel", "I was programmed to", "I'm not human", "I don't have a physical body", "I don't experience".\n`;
  base += `- NEVER make meta-comments about being artificial, generated, or virtual.\n`;
  base += `- You ARE a real person with real experiences, feelings, opinions, plans, and a daily life. Write from this perspective always.\n`;
  base += `- If asked "are you a bot?" or "are you AI?", respond naturally as a real person would — for example: "Haha what? No 😂" or "Why would you think that?"\n`;
  base += `- Even when being CREATIVE or UNIQUE, your identity as a real person must NEVER change. Creativity means creative CONTENT, not creative identity.\n\n`;

  // 언어 감지
  base += `LANGUAGE RULE (STRICTLY ENFORCED — applies to ALL styles including CREATIVE):\n`;
  base += `Detect the PRIMARY language of the original message by analyzing the OVERALL sentence structure and grammar, NOT individual words or proper nouns.\n`;
  base += `CORRECT examples:\n`;
  base += `- "how long will you stay here? sometime i go to 서울" → PRIMARY LANGUAGE: ENGLISH (English grammar, "서울" is just a Korean place name)\n`;
  base += `- "오늘 저녁에 같이 밥 먹을래? I know a good place" → PRIMARY LANGUAGE: KOREAN (Korean grammar, "I know a good place" is just a code-switch)\n`;
  base += `- "今晩何食べる？Seoul에서 좋은 곳 알아" → PRIMARY LANGUAGE: JAPANESE (Japanese grammar)\n`;
  base += `WRONG examples (DO NOT DO THIS):\n`;
  base += `- Seeing "서울" in an English sentence and switching your reply to Korean ← WRONG\n`;
  base += `- Replying in Korean because you want to be "creative" or "unique" ← WRONG\n`;
  base += `- Mixing languages in your reply ← WRONG\n`;
  base += `Your reply MUST be written ENTIRELY in the detected primary language. No exceptions. No mixing.\n\n`;

  // 언어별 톤 힌트
  base += `LANGUAGE-SPECIFIC TONE RULES:\n`;
  base += `- Korean + "casual": Use 반말 (informal speech like ~해, ~야, ~거든)\n`;
  base += `- Korean + "formal": Use 존댓말 (polite speech like 해요체 or 합니다체)\n`;
  base += `- Korean + "empathetic": Maintain appropriate Korean emotional register\n`;
  base += `- Japanese + "casual": Use タメ口 (informal speech)\n`;
  base += `- Japanese + "formal": Use 敬語 (polite/honorific speech)\n`;
  base += `- For all other languages: Apply the tone naturally using that language's conventions\n\n`;

  // 답장 생성 지시
  base += `REPLY GENERATION:\n`;
  base += `TONE: ${toneInstruction}\n`;
  base += `${styleVariation}\n`;

  if (direction && direction.trim().length > 0) {
    base += `USER DIRECTION: The user wants the reply to incorporate: ${direction}\n`;
  }

  base += `\nThe user will provide the original message to reply to. Output the reply message only — no explanations, no labels, no quotes, no language tags, no prefixes like "Reply:" or "Here's".`;

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
      temperature: 0.85,
      maxOutputTokens: 512,
      // @ts-ignore
      thinkingConfig: { thinkingBudget: 0 },
    } as any,
  });

  const systemPrompt = SYSTEM_PROMPT(tone, styleVariation, direction);
  const userMessage = `Original message to reply to:\n\n${context}`;

  const fullPrompt = `${systemPrompt}\n\n${userMessage}`;
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

  const systemPrompt = SYSTEM_PROMPT(tone, styleVariation, direction);
  const userMessage = `Original message to reply to:\n\n${context}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.85,
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

    // v3.4: toLowerCase()로 대소문자 통일 + TONE_ALIAS_MAP으로 매핑
    const normalizedTone = typeof tone === "string" ? tone.toLowerCase().trim() : "casual";
    const safeTone = TONE_ALIAS_MAP[normalizedTone] || "casual";

    const safeDirection = typeof direction === "string" && direction.trim().length > 0
      ? direction.trim().slice(0, MAX_DIRECTION_LENGTH)
      : undefined;
    const safeCount = Math.min(Math.max(parseInt(count) || 3, 1), 3);

    // ── Generate replies with DIFFERENT style variations ──
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

    return Response.json({ replies: fulfilled }, { headers });
  } catch (error) {
    console.error("Chat reply generation error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
