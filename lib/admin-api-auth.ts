import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isAllowedAdminEmail } from "@/lib/admin";

export type AdminAuthResult =
  | { ok: true; email: string }
  | { ok: false; response: NextResponse };

export async function verifyAdminApiRequest(request: Request): Promise<AdminAuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY." },
        { status: 500 }
      ),
    };
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing auth token." }, { status: 401 }),
    };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid auth token." }, { status: 401 }),
    };
  }

  if (!isAllowedAdminEmail(userData.user.email)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  return { ok: true, email: userData.user.email ?? "" };
}
