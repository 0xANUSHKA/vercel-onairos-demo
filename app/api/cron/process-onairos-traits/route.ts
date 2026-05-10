import { NextResponse } from "next/server";
import { extractOnairosApiCredentialsFromCompletion } from "@/lib/onairos-completion-credentials";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type WaitlistRow = {
  id: string | number;
  onairos_completion: unknown;
};

function shouldRetryLater(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const retryable = record.retryable === true;
  const training =
    record.training && typeof record.training === "object" && !Array.isArray(record.training)
      ? (record.training as Record<string, unknown>)
      : null;
  const trainingReady = training?.ready === true;
  return code === "TRAITS_REGENERATING" || (retryable && !trainingReady);
}

async function fetchTraits(apiUrl: string, token: string): Promise<unknown> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const errorBody = (await response.text()).trim();
    throw new Error(
      `Onairos fetch failed: ${response.status}${errorBody ? ` - ${errorBody}` : ""}`
    );
  }
  return response.json();
}

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const missing = missingSupabaseAdminEnv();
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Server misconfigured: missing ${missing.join(", ")}` },
        { status: 503 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("waitlist")
      .select("id, onairos_completion")
      .eq("onairos_traits_status", "pending")
      .not("onairos_completion", "is", null)
      .limit(20);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as WaitlistRow[];

    let processed = 0;
    let completed = 0;
    let failed = 0;
    let retried = 0;

    for (const row of rows) {
      processed += 1;
      const rowId = String(row.id);
      const details = extractOnairosApiCredentialsFromCompletion(row.onairos_completion);
      if (!details) {
        failed += 1;
        await supabase
          .from("waitlist")
          .update({
            onairos_traits_status: "failed",
            onairos_traits_error: "Missing apiUrl/token in onairos_completion",
          })
          .eq("id", row.id);
        continue;
      }

      const lock = await supabase
        .from("waitlist")
        .update({ onairos_traits_status: "processing", onairos_traits_error: null })
        .eq("id", row.id)
        .eq("onairos_traits_status", "pending");
      if (lock.error) {
        failed += 1;
        continue;
      }

      try {
        const traits = await fetchTraits(details.apiUrl, details.token);
        if (shouldRetryLater(traits)) {
          retried += 1;
          await supabase
            .from("waitlist")
            .update({
              onairos_traits_status: "pending",
              onairos_traits_error: null,
            })
            .eq("id", row.id);
          continue;
        }

        const { error: updateErr } = await supabase
          .from("waitlist")
          .update({
            onairos_traits: traits,
            onairos_traits_status: "complete",
            onairos_traits_error: null,
            onairos_traits_fetched_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (updateErr) {
          failed += 1;
          await supabase
            .from("waitlist")
            .update({
              onairos_traits_status: "failed",
              onairos_traits_error: updateErr.message,
            })
            .eq("id", row.id);
          continue;
        }
        completed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Unknown Onairos fetch error";
        await supabase
          .from("waitlist")
          .update({
            onairos_traits_status: "failed",
            onairos_traits_error: message,
          })
          .eq("id", rowId);
      }
    }

    return NextResponse.json({ ok: true, processed, completed, failed, retried });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
