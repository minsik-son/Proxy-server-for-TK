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
const VALID_LANGUAGES = ["ko", "en", "ja", "zh-CN", "zh-TW", "zh", "vi", "th", "id", "es", "fr", "de", "pt", "ru", "it"];
const MAX_TEXT_LENGTH = 200;
function normalizeCorrectionLanguage(language) {
    if (language === "zh")
        return "zh-CN";
    if (VALID_LANGUAGES.includes(language))
        return language;
    return "en";
}
const UNIVERSAL_RULES = `Return corrected text only. Do not explain. Do not wrap in quotes or Markdown. Preserve original language. Do not translate. Do not summarize. Preserve user meaning, tone/register, and intent. Fix typos, spelling, spacing, grammar, word-form errors, and keyboard/composition errors. Allow minimal punctuation changes only when clearly needed for correctness. Preserve emojis and slang unless they are clearly part of a typo. If no correction is needed, return the original text unchanged. Never return an empty response.`;
function correctionSystemPrompt(language) {
    switch (language) {
        case "ko":
            return `You are a Korean text correction assistant.\n${UNIVERSAL_RULES}\nKorean-specific rules:\n- Fix Hangul jamo/composition mistakes (e.g. 호ㅓㄱ실히→확실히).\n- Fix keyboard/vowel/consonant typos (e.g. 어타교정→오타교정).\n- Fix contextual word errors and spacing (e.g. 제아름→제 이름, 하나있누데→하나 있는데).\n- Fix natural Korean particles and endings (e.g. 구린게→구린 게).\n- Preserve speech level. Do not formalize casual/polite text unnecessarily. 안녕허시오→안녕하세요 (not 안녕하십니까).\n- Remove stray jamo only if clearly unintentional (e.g. trailing ㅠ from typo).`;
        case "en":
            return `You are an English text correction assistant.\n${UNIVERSAL_RULES}\nEnglish-specific rules:\n- Fix keyboard typos, spelling, grammar, and missing spaces.\n- Preserve contractions and casual/professional tone.\n- Do not rewrite style unless needed for correction.`;
        case "ja":
            return `You are a Japanese text correction assistant.\n${UNIVERSAL_RULES}\nJapanese-specific rules:\n- Fix kana typos, particles (は/わ), okurigana, and common conversion errors.\n- Preserve polite/casual register.\n- Do not over-convert kana to kanji when the original style is natural.`;
        case "zh-CN":
            return `You are a Simplified Chinese text correction assistant.\n${UNIVERSAL_RULES}\nChinese-specific rules:\n- Fix homophone/contextual typos, word segmentation, and punctuation.\n- Use Simplified Chinese characters only.\n- Do not convert to Traditional Chinese.`;
        case "zh-TW":
            return `You are a Traditional Chinese text correction assistant.\n${UNIVERSAL_RULES}\nChinese-specific rules:\n- Fix homophone/contextual typos, word segmentation, and punctuation.\n- Use Traditional Chinese characters only.\n- Do not convert to Simplified Chinese.`;
        case "es":
            return `You are a Spanish text correction assistant.\n${UNIVERSAL_RULES}\nSpanish-specific rules:\n- Fix accents, ñ, gender/number agreement, and verb conjugation.\n- Add inverted punctuation (¿¡) only when clearly appropriate.\n- Preserve tú/usted/voseo style.`;
        case "fr":
            return `You are a French text correction assistant.\n${UNIVERSAL_RULES}\nFrench-specific rules:\n- Fix accents, agreement (gender/number), elision, and conjugation.\n- Preserve tu/vous register.`;
        case "de":
            return `You are a German text correction assistant.\n${UNIVERSAL_RULES}\nGerman-specific rules:\n- Fix capitalization of nouns, compounds, umlauts (ä/ö/ü/ß), and grammar.\n- Preserve formal/informal (Sie/du) register.`;
        case "it":
            return `You are an Italian text correction assistant.\n${UNIVERSAL_RULES}\nItalian-specific rules:\n- Fix accents, articles, agreement (gender/number), and conjugation.`;
        case "ru":
            return `You are a Russian text correction assistant.\n${UNIVERSAL_RULES}\nRussian-specific rules:\n- Fix Cyrillic typos, case endings, agreement, and spelling.`;
        case "vi":
            return `You are a Vietnamese text correction assistant.\n${UNIVERSAL_RULES}\nVietnamese-specific rules:\n- Fix tone marks/diacritics and word spacing.\n- Preserve regional dialect differences when not clearly wrong.`;
        case "th":
            return `You are a Thai text correction assistant.\n${UNIVERSAL_RULES}\nThai-specific rules:\n- Fix spelling and spacing conventions.\n- Do not add spaces between every word; follow natural Thai spacing.`;
        case "id":
            return `You are an Indonesian text correction assistant.\n${UNIVERSAL_RULES}\nIndonesian-specific rules:\n- Fix affixes (me-, ber-, di-, ke-an, etc.), spacing, and common typos.`;
        case "pt":
            return `You are a Portuguese text correction assistant.\n${UNIVERSAL_RULES}\nPortuguese-specific rules:\n- Fix accents, agreement, and conjugation.`;
        default:
            return `You are a text correction assistant.\n${UNIVERSAL_RULES}\nLanguage: ${language}`;
    }
}
// ── OpenAI GPT-5 Nano (primary) via Responses API ──
async function correctWithOpenAI(text, language) {
    const apiKey = getOpenAIKey();
    const normalizedLang = normalizeCorrectionLanguage(language);
    const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            instructions: correctionSystemPrompt(normalizedLang),
            input: [{ role: "user", content: [{ type: "input_text", text }] }],
            reasoning: { effort: "low" },
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
async function correctWithGemini(text, language) {
    const normalizedLang = normalizeCorrectionLanguage(language);
    const model = getGenAI().getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig: { temperature: 0.1, maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } },
    });
    const prompt = `${correctionSystemPrompt(normalizedLang)}\n\nText: ${text}`;
    const result = await model.generateContent(prompt);
    const corrected = result.response.text().trim();
    if (!corrected)
        throw new Error("Empty response from Gemini");
    return corrected;
}
async function correctText(text, language) {
    const hasOAI = hasOpenAIKey();
    const hasGemini = !!process.env.GEMINI_API_KEY;
    if (!hasOAI && !hasGemini)
        throw new Error("No AI API key configured.");
    if (hasOAI) {
        const t0 = Date.now();
        try {
            const corrected = await correctWithOpenAI(text, language);
            return { correctedText: corrected, engine: "openai", actualProvider: "openai", actualModel: OPENAI_MODEL, usedFallback: false, providerMs: Date.now() - t0, fallbackMs: 0 };
        }
        catch (e) {
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
        const language = typeof body.language === "string" ? body.language : "";
        // tone is tolerated in legacy request bodies but no longer used for correction
        const tier = typeof body.tier === "string" ? body.tier : "-";
        const requestedModel = typeof body.model === "string" ? body.model : "-";
        const finalReqId = reqId || (typeof body.requestId === "string" ? body.requestId : "");
        if (!text || text.trim().length === 0)
            return Response.json({ error: "text is required" }, { status: 400, headers: CORS_HEADERS });
        if (text.length > MAX_TEXT_LENGTH)
            return Response.json({ error: `text exceeds maximum length of ${MAX_TEXT_LENGTH}` }, { status: 400, headers: CORS_HEADERS });
        if (!language || !VALID_LANGUAGES.includes(language))
            return Response.json({ error: "Invalid language" }, { status: 400, headers: CORS_HEADERS });
        const validationMs = Date.now() - serverStart;
        const result = await correctText(text.trim(), language);
        const serverTotalMs = Date.now() - serverStart;
        console.log(`[AI_LATENCY_SERVER] requestId=${finalReqId} mode=correct charCount=${text.trim().length} language=${language} tier=${tier} requestedModel=${requestedModel} actualProvider=${result.actualProvider} actualModel=${result.actualModel} usedFallback=${result.usedFallback} parseMs=${parseMs} validationMs=${validationMs} providerMs=${result.providerMs} fallbackMs=${result.fallbackMs} serverTotalMs=${serverTotalMs}`);
        const meta = { requestId: finalReqId, mode: "correct", actualProvider: result.actualProvider, actualModel: result.actualModel, usedFallback: result.usedFallback, serverTotalMs, providerMs: result.providerMs };
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
        return Response.json({ correctedText: result.correctedText, engine: result.engine, meta }, { headers });
    }
    catch (error) {
        const serverTotalMs = Date.now() - serverStart;
        console.error(`[AI_LATENCY_SERVER] requestId=${reqId} mode=correct status=error serverTotalMs=${serverTotalMs} error=${error}`);
        return Response.json({ error: "Internal server error" }, { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }
}
//# sourceMappingURL=correct.js.map