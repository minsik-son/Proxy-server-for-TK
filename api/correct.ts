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
  `Fix spelling, typos, and spacing only. Do NOT add or remove punctuation. Return corrected text only. If no correction is needed, return the original text unchanged. Never return an empty response. Language: ${language}`;

// ── OpenAI GPT-5 Nano (primary) via Responses API ──

async function correctWithOpenAI(text: string, language: string): Promise<string> {
  const apiKey = getOpenAIKey();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: SYSTEM_PROMPT(language),
      input: [{ role: "user", content: [{ type: "input_text", text }] }],
      reasoning: { effort: "minimal" },
      text: { verbosity: "low" },
      max_output_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.warn(`[AI_PROVIDER_FAIL] provider=openai model=${OPENAI_MODEL} httpStatus=${res.status} body=${errorBody.slice(0, 300)}`);
    throw new Error(`OpenAI HTTP ${res.status}`);
  }

  const data = await res.json();
  const result = extractResponseText(data);

  if (!result) {
    console.warn(`[AI_PROVIDER_EMPTY] provider=openai model=${OPENAI_MODEL} ${summarizeOpenAIResponse(data)}`);
    throw new Error("Empty response from OpenAI");
  }
  return result;
}

function extractResponseText(data: unknown): string {
  const root = data as Record<string, unknown>;
  if (typeof root.output_text === "string" && root.output_text.trim()) {
    return root.output_text.trim();
  }
  const parts: string[] = [];
  collectTextParts(root.output, parts);
  return parts.join("").trim();
}

function collectTextParts(value: unknown, parts: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTextParts(item, parts);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  if (typeof obj.text === "string" && obj.text.trim()) {
    parts.push(obj.text);
  }
  if (Array.isArray(obj.content)) collectTextParts(obj.content, parts);
  if (Array.isArray(obj.output)) collectTextParts(obj.output, parts);
}

function summarizeOpenAIResponse(data: unknown): string {
  const root = data as Record<string, unknown>;
  const status = typeof root.status === "string" ? root.status : "-";
  const incomplete = JSON.stringify(root.incomplete_details ?? null).slice(0, 200);
  const usage = root.usage && typeof root.usage === "object" ? root.usage as Record<string, unknown> : {};
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : "-";
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : "-";
  const reasoningTokens = usage.output_tokens_details && typeof usage.output_tokens_details === "object"
    && typeof (usage.output_tokens_details as Record<string, unknown>).reasoning_tokens === "number"
    ? (usage.output_tokens_details as Record<string, unknown>).reasoning_tokens : "-";
  const outputTypes = Array.isArray(root.output)
    ? root.output.map(item => item && typeof item === "object" ? String((item as Record<string, unknown>).type || "-") : "-").join(",") : "-";
  return `status=${status} incomplete=${incomplete} outputTokens=${outputTokens} reasoningTokens=${reasoningTokens} totalTokens=${totalTokens} outputTypes=${outputTypes}`;
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
