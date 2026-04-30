"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.default = handler;
const generative_ai_1 = require("@google/generative-ai");
exports.config = { runtime: "edge" };
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
const VALID_LANGUAGES = [
    "ko", "en", "ja", "zh", "es", "fr", "de", "pt", "ru", "it",
];
const MAX_TEXT_LENGTH = 200;
const SYSTEM_PROMPT = (sourceLang, targetLang) => `Translate from ${sourceLang} to ${targetLang}. Output translation only.`;
// ── Gemini (primary) ─────────────────────────────────
async function translateWithGemini(text, sourceLang, targetLang) {
    const model = getGenAI().getGenerativeModel({
        model: "gemini-2.5-flash-lite",
        generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 512,
            // @ts-ignore
            thinkingConfig: { thinkingBudget: 0 },
        },
    });
    const prompt = `${SYSTEM_PROMPT(sourceLang, targetLang)}\n\nText: ${text}`;
    const result = await model.generateContent(prompt);
    const translated = result.response.text().trim();
    if (!translated)
        throw new Error("Empty response from Gemini");
    return translated;
}
// ── OpenAI (fallback) ────────────────────────────────
async function translateWithOpenAI(text, sourceLang, targetLang) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
        throw new Error("NO_OPENAI_KEY");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT(sourceLang, targetLang) },
                { role: "user", content: text },
            ],
            temperature: 0.3,
            max_tokens: 1024,
        }),
    });
    const data = await res.json();
    const result = data.choices?.[0]?.message?.content?.trim();
    if (!result)
        throw new Error("Empty response from OpenAI");
    return result;
}
async function translateText(text, sourceLang, targetLang) {
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    if (!hasGemini && !hasOpenAI) {
        throw new Error("No AI API key configured.");
    }
    if (hasGemini) {
        const t0 = Date.now();
        try {
            const translated = await translateWithGemini(text, sourceLang, targetLang);
            return { translatedText: translated, engine: "gemini", actualProvider: "gemini", actualModel: "gemini-2.5-flash-lite", usedFallback: false, providerMs: Date.now() - t0, fallbackMs: 0 };
        }
        catch (e) {
            const geminiMs = Date.now() - t0;
            console.warn("Gemini failed:", e);
            if (hasOpenAI) {
                const t1 = Date.now();
                const translated = await translateWithOpenAI(text, sourceLang, targetLang);
                return { translatedText: translated, engine: "openai", actualProvider: "openai", actualModel: "gpt-4o-mini", usedFallback: true, providerMs: Date.now() - t1, fallbackMs: geminiMs };
            }
            throw e;
        }
    }
    const t0 = Date.now();
    const translated = await translateWithOpenAI(text, sourceLang, targetLang);
    return { translatedText: translated, engine: "openai", actualProvider: "openai", actualModel: "gpt-4o-mini", usedFallback: false, providerMs: Date.now() - t0, fallbackMs: 0 };
}
// ── Edge Handler ─────────────────────────────────────
async function handler(req) {
    const serverStart = Date.now();
    // CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, X-OneBoard-Request-ID",
            },
        });
    }
    if (req.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    const reqId = req.headers.get("X-OneBoard-Request-ID") || "";
    try {
        const body = await req.json();
        const parseMs = Date.now() - serverStart;
        const { text, sourceLang, targetLang, tier, model: requestedModel, requestId: bodyReqId } = body;
        const finalReqId = reqId || bodyReqId || "";
        if (!text || typeof text !== "string" || text.trim().length === 0) {
            return Response.json({ error: "text is required" }, { status: 400 });
        }
        if (text.length > MAX_TEXT_LENGTH) {
            return Response.json({ error: `text exceeds maximum length of ${MAX_TEXT_LENGTH}` }, { status: 400 });
        }
        if (!sourceLang || !VALID_LANGUAGES.includes(sourceLang)) {
            return Response.json({ error: "Invalid sourceLang" }, { status: 400 });
        }
        if (!targetLang || !VALID_LANGUAGES.includes(targetLang)) {
            return Response.json({ error: "Invalid targetLang" }, { status: 400 });
        }
        const validationMs = Date.now() - serverStart;
        const result = await translateText(text.trim(), sourceLang, targetLang);
        const serverTotalMs = Date.now() - serverStart;
        // Server-side latency log (no raw text)
        console.log(`[AI_LATENCY_SERVER] requestId=${finalReqId} mode=translate charCount=${text.trim().length} sourceLang=${sourceLang} targetLang=${targetLang} tier=${tier || "-"} requestedModel=${requestedModel || "-"} actualProvider=${result.actualProvider} actualModel=${result.actualModel} usedFallback=${result.usedFallback} parseMs=${parseMs} validationMs=${validationMs} providerMs=${result.providerMs} fallbackMs=${result.fallbackMs} serverTotalMs=${serverTotalMs}`);
        const meta = {
            requestId: finalReqId,
            mode: "translate",
            actualProvider: result.actualProvider,
            actualModel: result.actualModel,
            usedFallback: result.usedFallback,
            serverTotalMs,
            providerMs: result.providerMs,
        };
        const headers = {
            "Access-Control-Allow-Origin": "*",
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
        return Response.json({ error: "Internal server error" }, { status: 500, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } });
    }
}
//# sourceMappingURL=translate.js.map