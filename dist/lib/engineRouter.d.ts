interface TranslationResult {
    translatedText: string;
    engine: "deepl" | "gpt-4o-mini" | "gemini";
}
export declare function routeTranslation(text: string, sourceLang: string, targetLang: string, tier: "free" | "pro", monthlyUsage: number): Promise<TranslationResult>;
export {};
//# sourceMappingURL=engineRouter.d.ts.map