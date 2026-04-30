"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeTranslation = routeTranslation;
const deepl = __importStar(require("deepl-node"));
const openai_1 = __importDefault(require("openai"));
const generative_ai_1 = require("@google/generative-ai");
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
const DEEPL_CHAR_LIMIT = 135000;
const DEEPL_SOURCE_LANGS = {
    ko: "ko",
    en: "en",
    ja: "ja",
    zh: "zh",
    es: "es",
    fr: "fr",
    de: "de",
    pt: "pt",
    ru: "ru",
    it: "it",
};
const DEEPL_TARGET_LANGS = {
    ko: "ko",
    en: "en-US",
    ja: "ja",
    zh: "zh-HANS",
    es: "es",
    fr: "fr",
    de: "de",
    pt: "pt-BR",
    ru: "ru",
    it: "it",
};
async function translateWithDeepL(text, sourceLang, targetLang) {
    const apiKey = process.env.DEEPL_API_KEY;
    if (!apiKey) {
        throw new Error("Missing DEEPL_API_KEY");
    }
    const translator = new deepl.Translator(apiKey);
    const source = DEEPL_SOURCE_LANGS[sourceLang];
    const target = DEEPL_TARGET_LANGS[targetLang];
    if (!target) {
        throw new Error(`Unsupported DeepL target language: ${targetLang}`);
    }
    const result = await translator.translateText(text, source ?? null, target);
    return result.text;
}
async function translateWithGPT(text, sourceLang, targetLang) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("NO_OPENAI_KEY");
    }
    const openai = new openai_1.default({ apiKey });
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            {
                role: "system",
                content: `You are a professional translator. Translate the given text from ${sourceLang} to ${targetLang}. Output only the translated text without any explanations or additional text.`,
            },
            {
                role: "user",
                content: text,
            },
        ],
        temperature: 0.3,
        max_tokens: 1024,
    });
    const translated = response.choices[0]?.message?.content?.trim();
    if (!translated) {
        throw new Error("Empty response from GPT");
    }
    return translated;
}
async function translateWithGemini(text, sourceLang, targetLang) {
    const model = getGenAI().getGenerativeModel({
        model: "gemini-2.5-flash-lite",
        generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 512,
            // @ts-ignore - disable thinking for faster response
            thinkingConfig: { thinkingBudget: 0 },
        },
    });
    const prompt = `You are a professional translator. Translate the given text from ${sourceLang} to ${targetLang}. Output only the translated text without any explanations or additional text.\n\nText: ${text}`;
    const result = await model.generateContent(prompt);
    const translated = result.response.text().trim();
    if (!translated) {
        throw new Error("Empty response from Gemini");
    }
    return translated;
}
// Try available AI providers (GPT or Gemini) with fallback
async function translateWithAI(text, sourceLang, targetLang) {
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasGemini = !!process.env.GEMINI_API_KEY;
    if (!hasOpenAI && !hasGemini) {
        throw new Error("No AI API key configured. Set OPENAI_API_KEY or GEMINI_API_KEY.");
    }
    // Build provider list: try available ones in order
    const providers = [];
    if (hasOpenAI)
        providers.push({ fn: () => translateWithGPT(text, sourceLang, targetLang), engine: "gpt-4o-mini" });
    if (hasGemini)
        providers.push({ fn: () => translateWithGemini(text, sourceLang, targetLang), engine: "gemini" });
    for (const provider of providers) {
        try {
            const translatedText = await provider.fn();
            return { translatedText, engine: provider.engine };
        }
        catch (error) {
            console.warn(`Translation provider ${provider.engine} failed:`, error);
            continue;
        }
    }
    throw new Error("All AI providers failed");
}
async function routeTranslation(text, sourceLang, targetLang, tier, monthlyUsage) {
    // Free tier → AI (GPT or Gemini, whichever is available)
    if (tier === "free") {
        const { translatedText, engine } = await translateWithAI(text, sourceLang, targetLang);
        return { translatedText, engine };
    }
    // Pro tier with usage over limit → AI
    if (monthlyUsage > DEEPL_CHAR_LIMIT) {
        const { translatedText, engine } = await translateWithAI(text, sourceLang, targetLang);
        return { translatedText, engine };
    }
    // Pro tier within limit → try DeepL, fallback to AI
    try {
        const translatedText = await translateWithDeepL(text, sourceLang, targetLang);
        return { translatedText, engine: "deepl" };
    }
    catch {
        const { translatedText, engine } = await translateWithAI(text, sourceLang, targetLang);
        return { translatedText, engine };
    }
}
//# sourceMappingURL=engineRouter.js.map