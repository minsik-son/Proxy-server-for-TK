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

const SYSTEM_PROMPT = (sourceLang: string, targetLang: string) =>
  `Translate from ${sourceLang} to ${targetLang}. Output translation only.`;

// ── OpenAI GPT-5 Nano (primary) via Responses API ──

async function translateWithOpenAI(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const apiKey = getOpenAIKey();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: SYSTEM_PROMPT(sourceLang, targetLang),
      input: text,
      reasoning: { effort: "minimal" },
      text: { verbosity: "low" },
      max_output_tokens: 512,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);

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

async function translateWithGemini(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const model = getGenAI().getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0.3, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } } as any,
  });
  const prompt = `${SYSTEM_PROMPT(sourceLang, targetLang)}\n\nText: ${text}`;
  const result = await model.generateContent(prompt);
  const translated = result.response.text().trim();
  if (!translated) throw new Error("Empty response from Gemini");
  return translated;
}

// ── Provider selection: OpenAI primary, Gemini fallback ──

interface TranslationResult {
  translatedText: string; engine: string; actualProvider: string; actualModel: string;
  usedFallback: boolean; providerMs: number; fallbackMs: number;
}

async function translateText(text: string, sourceLang: string, targetLang: string): Promise<TranslationResult> {
  const hasOAI = hasOpenAIKey();
  const hasGemini = !!process.env.GEMINI_API_KEY;
  if (!hasOAI && !hasGemini) throw new Error("No AI API key configured.");

  if (hasOAI) {
    const t0 = Date.now();
    try {
      const translated = await translateWithOpenAI(text, sourceLang, targetLang);
      return { translatedText: translated, engine: "openai", actualProvider: "openai", actualModel: OPENAI_MODEL, usedFallback: false, providerMs: Date.now() - t0, fallbackMs: 0 };
    } catch (e: any) {
      const oaiMs = Date.now() - t0;
      console.warn(`[AI_PROVIDER_FAIL] provider=openai model=${OPENAI_MODEL} errorName=${e?.name || "-"} status=${e?.status || "-"} message=${String(e?.message || "").slice(0, 120)}`);
      if (hasGemini) {
        const t1 = Date.now();
        const translated = await translateWithGemini(text, sourceLang, targetLang);
        return { translatedText: translated, engine: "gemini", actualProvider: "gemini", actualModel: GEMINI_MODEL, usedFallback: true, providerMs: Date.now() - t1, fallbackMs: oaiMs };
      }
      throw e;
    }
  }

  const t0 = Date.now();
  const translated = await translateWithGemini(text, sourceLang, targetLang);
  return { translatedText: translated, engine: "gemini", actualProvider: "gemini", actualModel: GEMINI_MODEL, usedFallback: false, providerMs: Date.now() - t0, fallbackMs: 0 };
}

// ── CORS ──

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-OneBoard-Request-ID",
};

// ── Edge Handler ──

interface TranslateRequestBody { text?: unknown; sourceLang?: unknown; targetLang?: unknown; tier?: unknown; model?: unknown; requestId?: unknown; }

export default async function handler(req: Request): Promise<Response> {
  const serverStart = Date.now();

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });

  const reqId = req.headers.get("X-OneBoard-Request-ID") || "";

  try {
    const body = (await req.json()) as TranslateRequestBody;
    const parseMs = Date.now() - serverStart;
    const text = typeof body.text === "string" ? body.text : "";
    const sourceLang = typeof body.sourceLang === "string" ? body.sourceLang : "";
    const targetLang = typeof body.targetLang === "string" ? body.targetLang : "";
    const tier = typeof body.tier === "string" ? body.tier : "-";
    const requestedModel = typeof body.model === "string" ? body.model : "-";
    const finalReqId = reqId || (typeof body.requestId === "string" ? body.requestId : "");

    if (!text || text.trim().length === 0) return Response.json({ error: "text is required" }, { status: 400, headers: CORS_HEADERS });
    if (text.length > MAX_TEXT_LENGTH) return Response.json({ error: `text exceeds maximum length of ${MAX_TEXT_LENGTH}` }, { status: 400, headers: CORS_HEADERS });
    if (!sourceLang || !VALID_LANGUAGES.includes(sourceLang)) return Response.json({ error: "Invalid sourceLang" }, { status: 400, headers: CORS_HEADERS });
    if (!targetLang || !VALID_LANGUAGES.includes(targetLang)) return Response.json({ error: "Invalid targetLang" }, { status: 400, headers: CORS_HEADERS });

    const validationMs = Date.now() - serverStart;
    const result = await translateText(text.trim(), sourceLang, targetLang);
    const serverTotalMs = Date.now() - serverStart;

    console.log(`[AI_LATENCY_SERVER] requestId=${finalReqId} mode=translate charCount=${text.trim().length} sourceLang=${sourceLang} targetLang=${targetLang} tier=${tier} requestedModel=${requestedModel} actualProvider=${result.actualProvider} actualModel=${result.actualModel} usedFallback=${result.usedFallback} parseMs=${parseMs} validationMs=${validationMs} providerMs=${result.providerMs} fallbackMs=${result.fallbackMs} serverTotalMs=${serverTotalMs}`);

    const meta = { requestId: finalReqId, mode: "translate", actualProvider: result.actualProvider, actualModel: result.actualModel, usedFallback: result.usedFallback, serverTotalMs, providerMs: result.providerMs };

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

    return Response.json({ translatedText: result.translatedText, engine: result.engine, charCount: text.length, meta }, { headers });
  } catch (error) {
    const serverTotalMs = Date.now() - serverStart;
    console.error(`[AI_LATENCY_SERVER] requestId=${reqId} mode=translate status=error serverTotalMs=${serverTotalMs} error=${error}`);
    return Response.json({ error: "Internal server error" }, { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
}
