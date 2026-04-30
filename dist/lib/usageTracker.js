"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsage = getUsage;
exports.addUsage = addUsage;
const supabase_js_1 = require("@supabase/supabase-js");
function getSupabaseClient() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
        return null; // Supabase not configured — skip tracking
    }
    return (0, supabase_js_1.createClient)(url, key);
}
function getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
}
async function getUsage(deviceId) {
    const supabase = getSupabaseClient();
    if (!supabase)
        return 0; // No tracking — return 0 usage
    const month = getCurrentMonth();
    const { data, error } = await supabase
        .from("usage")
        .select("char_count")
        .eq("device_id", deviceId)
        .eq("month", month)
        .single();
    if (error && error.code !== "PGRST116") {
        console.warn(`Failed to get usage: ${error.message}`);
        return 0;
    }
    return data?.char_count ?? 0;
}
async function addUsage(deviceId, charCount) {
    const supabase = getSupabaseClient();
    if (!supabase)
        return; // No tracking — skip silently
    const month = getCurrentMonth();
    const { data: existing } = await supabase
        .from("usage")
        .select("char_count")
        .eq("device_id", deviceId)
        .eq("month", month)
        .single();
    if (existing) {
        const { error } = await supabase
            .from("usage")
            .update({
            char_count: existing.char_count + charCount,
            updated_at: new Date().toISOString(),
        })
            .eq("device_id", deviceId)
            .eq("month", month);
        if (error) {
            console.warn(`Failed to update usage: ${error.message}`);
        }
    }
    else {
        const { error } = await supabase.from("usage").insert({
            device_id: deviceId,
            char_count: charCount,
            month: month,
            updated_at: new Date().toISOString(),
        });
        if (error) {
            console.warn(`Failed to insert usage: ${error.message}`);
        }
    }
}
//# sourceMappingURL=usageTracker.js.map