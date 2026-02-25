import * as deepl from "deepl-node";
import OpenAI from "openai";

interface TranslationResult {
  translatedText: string;
  engine: "deepl" | "gpt-4o-mini";
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
  zh: "zh-Hans",
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
    throw new Error("Missing OPENAI_API_KEY");
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

export async function routeTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
  tier: "free" | "pro",
  monthlyUsage: number
): Promise<TranslationResult> {
  // Free tier → always GPT-4o-mini
  if (tier === "free") {
    const translatedText = await translateWithGPT(text, sourceLang, targetLang);
    return { translatedText, engine: "gpt-4o-mini" };
  }

  // Pro tier with usage over limit → GPT-4o-mini
  if (monthlyUsage > DEEPL_CHAR_LIMIT) {
    const translatedText = await translateWithGPT(text, sourceLang, targetLang);
    return { translatedText, engine: "gpt-4o-mini" };
  }

  // Pro tier within limit → try DeepL, fallback to GPT-4o-mini
  try {
    const translatedText = await translateWithDeepL(text, sourceLang, targetLang);
    return { translatedText, engine: "deepl" };
  } catch {
    const translatedText = await translateWithGPT(text, sourceLang, targetLang);
    return { translatedText, engine: "gpt-4o-mini" };
  }
}
