"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRateLimit = checkRateLimit;
const LIMITS = {
    free: 60,
    pro: 120,
};
const WINDOW_MS = 60 * 1000; // 1 minute
const store = new Map();
// Clean up expired entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);
        if (entry.timestamps.length === 0) {
            store.delete(key);
        }
    }
}, 5 * 60 * 1000);
function checkRateLimit(deviceId, tier) {
    const key = `${deviceId}:${tier}`;
    const limit = LIMITS[tier];
    const now = Date.now();
    let entry = store.get(key);
    if (!entry) {
        entry = { timestamps: [] };
        store.set(key, entry);
    }
    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);
    if (entry.timestamps.length >= limit) {
        const oldest = entry.timestamps[0];
        const retryAfter = Math.ceil((oldest + WINDOW_MS - now) / 1000);
        return { allowed: false, retryAfter };
    }
    entry.timestamps.push(now);
    return { allowed: true };
}
//# sourceMappingURL=rateLimiter.js.map