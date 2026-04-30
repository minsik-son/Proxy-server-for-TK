import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = { runtime: "edge" };

const OPENAI_MODEL = "gpt-5-nano";
const GEMINI_MODEL = "gemini-2.5-flash-lite";

function getOpenAIKey(): string {
  const apiKey = process.env.OpenAI_5_Nano || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("NO_OPENAI_KEY");
  return apiKey;
}

function hasOpenAIKey(): boolean {
  return !!(process.env.OpenAI_5_Nano || process.env.OPENAI_API_KEY);
}

let _genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("NO_GEMINI_KEY");
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

const VALID_LANGUAGES = ["ko","en","ja","zh","es","fr","de","pt","ru","it"];
const MAX_TEXT_LENGTH = 200;

const SYSTEM_PROMPT = (language: string) =>
  `Fix spelling, typos, and spacing only. Do NOT add or remove punctuation. Return corrected text only. Language: ${language}`;

// ── OpenAI GPT-5 Nano (primary) via Responses API ──

async function correctWithOpenAI(text: string, language: string): Promise<string> {
  const apiKey = getOpenAIKey();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: SYSTEM_PROMPT(language),
      input: text,
      reasoning: { effort: "minimal" },
      text: { verbosity: "low" },
      max_output_tokens: 256,
    }),
  });

  if (!res.ok) {
    const status = res.status;
    throw new Error(`OpenAI HTTP ${status}`);
  }

  const data = await res.json();
  const result = typeof data.output_text === "string" && data.output_text.trim()
    ? data.output_text.trim()
    : extractTextFromOutput(data.output);

  if (!result) throw new Error("Empty response from OpenAI");
  return result;
}

function extractTextFromOutput(output: unknown): string {
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    if (item && typeof item === "object" && "text" in item && typeof (item as Record<string, unknown>).text === "string") {
      const t = ((item as Record<string, unknown>).text as string).trim();
      if (t) return t;
    }
  }
  return "";
}

// ── Gemini (fallback) ──

async function correctWithGemini(text: string, language: string): Promise<string> {
  const model = getGenAI().getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0.1, maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } } as any,
  });
  const prompt = `${SYSTEM_PROMPT(language)}\n\nText: ${text}`;
  const result = await model.generateContent(prompt);
  const corrected = result.response.text().trim();
  if (!corrected) throw new Error("Empty response from Gemini");
  return corrected;
}

// ── Provider selection: OpenAI primary, Gemini fallback ──

interface CorrectionResult {
  correctedText: string; engine: string; actualProvider: string; actualModel: string;
  usedFallback: boolean; providerMs: number; fallbackMs: number;
}

async function correctText(text: string, language: string): Promise<CorrectionResult> {
  const hasOAI = hasOpenAIKey();
  const hasGemini = !!process.env.GEMINI_API_KEY;
  if (!hasOAI && !hasGemini) throw new Error("No AI API key configured.");

  if (hasOAI) {
    const t0 = Date.now();
    try {
      const corrected = await correctWithOpenAI(text, language);
      return { correctedText: corrected, engine: "openai", actualProvider: "openai", actualModel: OPENAI_MODEL, usedFallback: false, providerMs: Date.now() - t0, fallbackMs: 0 };
    } catch (e: any) {
      const oaiMs = Date.now() - t0;
      console.warn(`[AI_PROVIDER_FAIL] provider=openai model=${OPENAI_MODEL} errorName=${e?.name || "-"} status=${e?.status || "-"} message=${String(e?.message || "").slice(0, 120)}`);
      if (hasGemini) {
        const t1 = Date.now();
        const corrected = await correctWithGemini(text, language);
        return { correctedText: corrected, engine: "gemini", actualProvider: "gemini", actualModel: GEMINI_MODEL, usedFallback: true, providerMs: Date.now() - t1, fallbackMs: oaiMs };
      }
      throw e;
    }
  }

  const t0 = Date.now();
  const corrected = await correctWithGemini(text, language);
  return { correctedText: corrected, engine: "gemini", actualProvider: "gemini", actualModel: GEMINI_MODEL, usedFallback: false, providerMs: Date.now() - t0, fallbackMs: 0 };
}

// ── CORS ──

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-OneBoard-Request-ID",
};

// ── Edge Handler ──

interface CorrectRequestBody { text?: unknown; language?: unknown; tone?: unknown; tier?: unknown; model?: unknown; requestId?: unknown; }  // tone tolerated but ignored

export default async function handler(req: Request): Promise<Response> {
  const serverStart = Date.now();

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });

  const reqId = req.headers.get("X-OneBoard-Request-ID") || "";

  try {
    const body = (await req.json()) as CorrectRequestBody;
    const parseMs = Date.now() - serverStart;
    const text = typeof body.text === "string" ? body.text : "";
    const language = typeof body.language === "string" ? body.language : "";
    // tone is tolerated in legacy request bodies but no longer used for correction
    const tier = typeof body.tier === "string" ? body.tier : "-";
    const requestedModel = typeof body.model === "string" ? body.model : "-";
    const finalReqId = reqId || (typeof body.requestId === "string" ? body.requestId : "");

    if (!text || text.trim().length === 0) return Response.json({ error: "text is required" }, { status: 400, headers: CORS_HEADERS });
    if (text.length > MAX_TEXT_LENGTH) return Response.json({ error: `text exceeds maximum length of ${MAX_TEXT_LENGTH}` }, { status: 400, headers: CORS_HEADERS });
    if (!language || !VALID_LANGUAGES.includes(language)) return Response.json({ error: "Invalid language" }, { status: 400, headers: CORS_HEADERS });

    const validationMs = Date.now() - serverStart;
    const result = await correctText(text.trim(), language);
    const serverTotalMs = Date.now() - serverStart;

    console.log(`[AI_LATENCY_SERVER] requestId=${finalReqId} mode=correct charCount=${text.trim().length} language=${language} tier=${tier} requestedModel=${requestedModel} actualProvider=${result.actualProvider} actualModel=${result.actualModel} usedFallback=${result.usedFallback} parseMs=${parseMs} validationMs=${validationMs} providerMs=${result.providerMs} fallbackMs=${result.fallbackMs} serverTotalMs=${serverTotalMs}`);

    const meta = { requestId: finalReqId, mode: "correct", actualProvider: result.actualProvider, actualModel: result.actualModel, usedFallback: result.usedFallback, serverTotalMs, providerMs: result.providerMs };

    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "X-OneBoard-Request-ID": finalReqId,
      "X-OneBoard-AI-Provider": result.actualProvider,
      "X-OneBoard-AI-Model": result.actualModel,
      "X-OneBoard-Server-Timing-Ms": String(serverTotalMs),
      "Server-Timing": `parse;dur=${parseMs}, provider;dur=${result.providerMs}, total;dur=${serverTotalMs}`,
      "Access-Control-Expose-Headers": "X-OneBoard-Request-ID, X-OneBoard-AI-Provider, X-OneBoard-AI-Model, X-OneBoard-Server-Timing-Ms, Server-Timing",
    };

    return Response.json({ correctedText: result.correctedText, engine: result.engine, meta }, { headers });
  } catch (error) {
    const serverTotalMs = Date.now() - serverStart;
    console.error(`[AI_LATENCY_SERVER] requestId=${reqId} mode=correct status=error serverTotalMs=${serverTotalMs} error=${error}`);
    return Response.json({ error: "Internal server error" }, { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
}
