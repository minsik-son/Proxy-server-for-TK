"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.default = handler;
const generative_ai_1 = require("@google/generative-ai");
exports.config = { runtime: "edge" };
const OPENAI_MODEL = "gpt-5-nano";
const GEMINI_MODEL = "gemini-2.5-flash-lite";
function getOpenAIKey() {
    const apiKey = process.env.OpenAI_5_Nano || process.env.OPENAI_API_KEY;
    if (!apiKey)
        throw new Error("NO_OPENAI_KEY");
    return apiKey;
}
function hasOpenAIKey() {
    return !!(process.env.OpenAI_5_Nano || process.env.OPENAI_API_KEY);
}
let _genAI = null;
function getGenAI() {
    if (!_genAI) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey)
            throw new Error("NO_GEMINI_KEY");
        _genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    }
    return _genAI;
}
const VALID_LANGUAGES = ["ko", "en", "ja", "zh", "es", "fr", "de", "pt", "ru", "it"];
const MAX_TEXT_LENGTH = 200;
const SYSTEM_PROMPT = (sourceLang, targetLang) => `Translate from ${sourceLang} to ${targetLang}. Output translation only. Always return the translated text. Never return an empty response. If the source and target languages are the same, return the original text unchanged.`;
// ── OpenAI GPT-5 Nano (primary) via Responses API ──
async function translateWithOpenAI(text, sourceLang, targetLang) {
    const apiKey = getOpenAIKey();
    const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            instructions: SYSTEM_PROMPT(sourceLang, targetLang),
            input: [{ role: "user", content: [{ type: "input_text", text }] }],
            reasoning: { effort: "minimal" },
            text: { verbosity: "low" },
            max_output_tokens: 1536,
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
function extractResponseText(data) {
    const root = data;
    if (typeof root.output_text === "string" && root.output_text.trim()) {
        return root.output_text.trim();
    }
    const parts = [];
    collectTextParts(root.output, parts);
    return parts.join("").trim();
}
function collectTextParts(value, parts) {
    if (Array.isArray(value)) {
        for (const item of value)
            collectTextParts(item, parts);
        return;
    }
    if (!value || typeof value !== "object")
        return;
    const obj = value;
    if (typeof obj.text === "string" && obj.text.trim()) {
        parts.push(obj.text);
    }
    if (Array.isArray(obj.content))
        collectTextParts(obj.content, parts);
    if (Array.isArray(obj.output))
        collectTextParts(obj.output, parts);
}
function summarizeOpenAIResponse(data) {
    const root = data;
    const status = typeof root.status === "string" ? root.status : "-";
    const incomplete = JSON.stringify(root.incomplete_details ?? null).slice(0, 200);
    const usage = root.usage && typeof root.usage === "object" ? root.usage : {};
    const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : "-";
    const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : "-";
    const reasoningTokens = usage.output_tokens_details && typeof usage.output_tokens_details === "object"
        && typeof usage.output_tokens_details.reasoning_tokens === "number"
        ? usage.output_tokens_details.reasoning_tokens : "-";
    const outputTypes = Array.isArray(root.output)
        ? root.output.map(item => item && typeof item === "object" ? String(item.type || "-") : "-").join(",") : "-";
    return `status=${status} incomplete=${incomplete} outputTokens=${outputTokens} reasoningTokens=${reasoningTokens} totalTokens=${totalTokens} outputTypes=${outputTypes}`;
}
// ── Gemini (fallback) ──
async function translateWithGemini(text, sourceLang, targetLang) {
    const model = getGenAI().getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig: { temperature: 0.3, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
    });
    const prompt = `${SYSTEM_PROMPT(sourceLang, targetLang)}\n\nText: ${text}`;
    const result = await model.generateContent(prompt);
    const translated = result.response.text().trim();
    if (!translated)
        throw new Error("Empty response from Gemini");
    return translated;
}
async function translateText(text, sourceLang, targetLang) {
    const hasOAI = hasOpenAIKey();
    const hasGemini = !!process.env.GEMINI_API_KEY;
    if (!hasOAI && !hasGemini)
        throw new Error("No AI API key configured.");
    if (hasOAI) {
        const t0 = Date.now();
        try {
            const translated = await translateWithOpenAI(text, sourceLang, targetLang);
            return { translatedText: translated, engine: "openai", actualProvider: "openai", actualModel: OPENAI_MODEL, usedFallback: false, providerMs: Date.now() - t0, fallbackMs: 0 };
        }
        catch (e) {
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
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-OneBoard-Request-ID",
};
async function handler(req) {
    const serverStart = Date.now();
    if (req.method === "OPTIONS")
        return new Response(null, { status: 200, headers: CORS_HEADERS });
    if (req.method !== "POST")
        return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
    const reqId = req.headers.get("X-OneBoard-Request-ID") || "";
    try {
        const body = (await req.json());
        const parseMs = Date.now() - serverStart;
        const text = typeof body.text === "string" ? body.text : "";
        const sourceLang = typeof body.sourceLang === "string" ? body.sourceLang : "";
        const targetLang = typeof body.targetLang === "string" ? body.targetLang : "";
        const tier = typeof body.tier === "string" ? body.tier : "-";
        const requestedModel = typeof body.model === "string" ? body.model : "-";
        const finalReqId = reqId || (typeof body.requestId === "string" ? body.requestId : "");
        if (!text || text.trim().length === 0)
            return Response.json({ error: "text is required" }, { status: 400, headers: CORS_HEADERS });
        if (text.length > MAX_TEXT_LENGTH)
            return Response.json({ error: `text exceeds maximum length of ${MAX_TEXT_LENGTH}` }, { status: 400, headers: CORS_HEADERS });
        if (!sourceLang || !VALID_LANGUAGES.includes(sourceLang))
            return Response.json({ error: "Invalid sourceLang" }, { status: 400, headers: CORS_HEADERS });
        if (!targetLang || !VALID_LANGUAGES.includes(targetLang))
            return Response.json({ error: "Invalid targetLang" }, { status: 400, headers: CORS_HEADERS });
        const validationMs = Date.now() - serverStart;
        const result = await translateText(text.trim(), sourceLang, targetLang);
        const serverTotalMs = Date.now() - serverStart;
        console.log(`[AI_LATENCY_SERVER] requestId=${finalReqId} mode=translate charCount=${text.trim().length} sourceLang=${sourceLang} targetLang=${targetLang} tier=${tier} requestedModel=${requestedModel} actualProvider=${result.actualProvider} actualModel=${result.actualModel} usedFallback=${result.usedFallback} parseMs=${parseMs} validationMs=${validationMs} providerMs=${result.providerMs} fallbackMs=${result.fallbackMs} serverTotalMs=${serverTotalMs}`);
        const meta = { requestId: finalReqId, mode: "translate", actualProvider: result.actualProvider, actualModel: result.actualModel, usedFallback: result.usedFallback, serverTotalMs, providerMs: result.providerMs };
        const headers = {
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
    }
    catch (error) {
        const serverTotalMs = Date.now() - serverStart;
        console.error(`[AI_LATENCY_SERVER] requestId=${reqId} mode=translate status=error serverTotalMs=${serverTotalMs} error=${error}`);
        return Response.json({ error: "Internal server error" }, { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }
}
//# sourceMappingURL=translate.js.map