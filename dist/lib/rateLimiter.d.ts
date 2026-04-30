interface RateLimitResult {
    allowed: boolean;
    retryAfter?: number;
}
export declare function checkRateLimit(deviceId: string, tier: "free" | "pro"): RateLimitResult;
export {};
//# sourceMappingURL=rateLimiter.d.ts.map