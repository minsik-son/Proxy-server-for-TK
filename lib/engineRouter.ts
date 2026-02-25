import * as deepl from "deepl-node";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

interface TranslationResult {
  translatedText: string;
  engine: "deepl" | "gpt-4o-mini" | "gemini";
}

const DEEPL_CHAR_LIMIT = 135_000;

const DEEPL_SOURCE_LANGS: Record<string, deepl.SourceLanguageCode> = {
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

const DEEPL_TARGET_LANGS: Record<string, deepl.TargetLanguageCode> = {
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

async function translateWithDeepL(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
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

  const result = await translator.translateText(
    text,
    source ?? null,
    target
  );

  return result.text;
}

async function translateWithGPT(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("NO_OPENAI_KEY");
  }

  const openai = new OpenAI({ apiKey });

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

async function translateWithGemini(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("NO_GEMINI_KEY");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `You are a professional translator. Translate the given text from ${sourceLang} to ${targetLang}. Output only the translated text without any explanations or additional text.\n\nText: ${text}`;
  const result = await model.generateContent(prompt);
  const translated = result.response.text().trim();

  if (!translated) {
    throw new Error("Empty response from Gemini");
  }

  return translated;
}

// Try available AI providers (GPT or Gemini) with fallback
async function translateWithAI(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<{ translatedText: string; engine: "gpt-4o-mini" | "gemini" }> {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  if (!hasOpenAI && !hasGemini) {
    throw new Error("No AI API key configured. Set OPENAI_API_KEY or GEMINI_API_KEY.");
  }

  // Build provider list: try available ones in order
  const providers: Array<{ fn: () => Promise<string>; engine: "gpt-4o-mini" | "gemini" }> = [];
  if (hasOpenAI) providers.push({ fn: () => translateWithGPT(text, sourceLang, targetLang), engine: "gpt-4o-mini" });
  if (hasGemini) providers.push({ fn: () => translateWithGemini(text, sourceLang, targetLang), engine: "gemini" });

  for (const provider of providers) {
    try {
      const translatedText = await provider.fn();
      return { translatedText, engine: provider.engine };
    } catch (error) {
      console.warn(`Translation provider ${provider.engine} failed:`, error);
      continue;
    }
  }

  throw new Error("All AI providers failed");
}

export async function routeTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
  tier: "free" | "pro",
  monthlyUsage: number
): Promise<TranslationResult> {
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
  } catch {
    const { translatedText, engine } = await translateWithAI(text, sourceLang, targetLang);
    return { translatedText, engine };
  }
}
