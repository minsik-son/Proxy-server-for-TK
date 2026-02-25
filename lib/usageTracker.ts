import { createClient } from "@supabase/supabase-js";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  }

  return createClient(url, key);
}

function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function getUsage(deviceId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const month = getCurrentMonth();

  const { data, error } = await supabase
    .from("usage")
    .select("char_count")
    .eq("device_id", deviceId)
    .eq("month", month)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to get usage: ${error.message}`);
  }

  return data?.char_count ?? 0;
}

export async function addUsage(
  deviceId: string,
  charCount: number
): Promise<void> {
  const supabase = getSupabaseClient();
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
      throw new Error(`Failed to update usage: ${error.message}`);
    }
  } else {
    const { error } = await supabase.from("usage").insert({
      device_id: deviceId,
      char_count: charCount,
      month: month,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Failed to insert usage: ${error.message}`);
    }
  }
}
