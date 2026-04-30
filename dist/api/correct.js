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
const TONE_INSTRUCTIONS = {
    none: "",
    casual: "\nConvert the text to casual/informal language (반말 in Korean). Use informal endings and relaxed tone (~해, ~야, ~거든). Do NOT add punctuation (commas, periods) that was not in the original text.",
    formal: "\nConvert the text to polite/formal language (존댓말 in Korean). Use 해요체 by default (~해요, ~이에요, ~하세요). If the context is clearly professional/business, use 합니다체 (~합니다, ~입니다). Do NOT add punctuation that was not in the original text.",
    polished: "\nKeep the original tone (반말/존댓말) exactly as-is, but properly insert all necessary punctuation marks: commas, periods, exclamation marks, question marks, etc. Ensure perfect spacing and clean sentence structure. This is a 'polished writing' mode — fix formatting and punctuation, not tone.",
};
const SYSTEM_PROMPT = (language, tone = "none") => {
    if (tone === "none" || !tone) {
        return `Fix spelling, typos, and spacing only. Do NOT add or remove punctuation. Return corrected text only. Language: ${language}`;
    }
    const toneInstruction = TONE_INSTRUCTIONS[tone] || "";
    return `Fix spelling/typos, then apply tone style.${toneInstruction} Return result only. Language: ${language}`;
};
// ── Gemini (primary) ─────────────────────────────────
async function correctWithGemini(text, language, tone) {
    const model = getGenAI().getGenerativeModel({
        model: "gemini-2.5-flash-lite",
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 256,
            // @ts-ignore
            thinkingConfig: { thinkingBudget: 0 },
        },
    });
    const prompt = `${SYSTEM_PROMPT(language, tone)}\n\nText: ${text}`;
    const result = await model.generateContent(prompt);
    const corrected = result.response.text().trim();
    if (!corrected)
        throw new Error("Empty response from Gemini");
    return corrected;
}
// ── OpenAI (fallback) ────────────────────────────────
async function correctWithOpenAI(text, language, tone) {
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
                { role: "system", content: SYSTEM_PROMPT(language, tone) },
                { role: "user", content: text },
            ],
            temperature: 0.1,
            max_tokens: 500,
        }),
    });
    const data = await res.json();
    const result = data.choices?.[0]?.message?.content?.trim();
    if (!result)
        throw new Error("Empty response from OpenAI");
    return result;
}
async function correctText(text, language, tone) {
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    if (!hasGemini && !hasOpenAI) {
        throw new Error("No AI API key configured.");
    }
    if (hasGemini) {
        const t0 = Date.now();
        try {
            const corrected = await correctWithGemini(text, language, tone);
            return { correctedText: corrected, engine: "gemini", actualProvider: "gemini", actualModel: "gemini-2.5-flash-lite", usedFallback: false, providerMs: Date.now() - t0, fallbackMs: 0 };
        }
        catch (e) {
            const geminiMs = Date.now() - t0;
            console.warn("Gemini failed:", e);
            if (hasOpenAI) {
                const t1 = Date.now();
                const corrected = await correctWithOpenAI(text, language, tone);
                return { correctedText: corrected, engine: "openai", actualProvider: "openai", actualModel: "gpt-4o-mini", usedFallback: true, providerMs: Date.now() - t1, fallbackMs: geminiMs };
            }
            throw e;
        }
    }
    const t0 = Date.now();
    const corrected = await correctWithOpenAI(text, language, tone);
    return { correctedText: corrected, engine: "openai", actualProvider: "openai", actualModel: "gpt-4o-mini", usedFallback: false, providerMs: Date.now() - t0, fallbackMs: 0 };
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
        const { text, language, tone, tier, model: requestedModel, requestId: bodyReqId } = body;
        const finalReqId = reqId || bodyReqId || "";
        const validTones = ["none", "casual", "formal", "polished"];
        const safeTone = validTones.includes(tone) ? tone : "none";
        if (!text || typeof text !== "string" || text.trim().length === 0) {
            return Response.json({ error: "text is required" }, { status: 400 });
        }
        if (text.length > MAX_TEXT_LENGTH) {
            return Response.json({ error: `text exceeds maximum length of ${MAX_TEXT_LENGTH}` }, { status: 400 });
        }
        if (!language || !VALID_LANGUAGES.includes(language)) {
            return Response.json({ error: "Invalid language" }, { status: 400 });
        }
        const validationMs = Date.now() - serverStart;
        const result = await correctText(text.trim(), language, safeTone);
        const serverTotalMs = Date.now() - serverStart;
        // Server-side latency log (no raw text)
        console.log(`[AI_LATENCY_SERVER] requestId=${finalReqId} mode=correct charCount=${text.trim().length} language=${language} tone=${safeTone} tier=${tier || "-"} requestedModel=${requestedModel || "-"} actualProvider=${result.actualProvider} actualModel=${result.actualModel} usedFallback=${result.usedFallback} parseMs=${parseMs} validationMs=${validationMs} providerMs=${result.providerMs} fallbackMs=${result.fallbackMs} serverTotalMs=${serverTotalMs}`);
        const meta = {
            requestId: finalReqId,
            mode: "correct",
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
        return Response.json({ correctedText: result.correctedText, engine: result.engine, meta }, { headers });
    }
    catch (error) {
        const serverTotalMs = Date.now() - serverStart;
        console.error(`[AI_LATENCY_SERVER] requestId=${reqId} mode=correct status=error serverTotalMs=${serverTotalMs} error=${error}`);
        return Response.json({ error: "Internal server error" }, { status: 500, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } });
    }
}
//# sourceMappingURL=correct.js.map