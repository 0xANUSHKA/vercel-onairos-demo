import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** Names of env vars that are required for server-side admin reads (never expose the key to the client). */
export function missingSupabaseAdminEnv(): string[] {
  const m: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) m.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) m.push("SUPABASE_SERVICE_ROLE_KEY");
  return m;
}

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      `Missing env: ${missingSupabaseAdminEnv().join(", ") || "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"}`,
    );
  }
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
