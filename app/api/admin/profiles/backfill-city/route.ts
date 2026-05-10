import { NextResponse } from "next/server";
import { verifyAdminApiRequest } from "@/lib/admin-api-auth";
import { getSupabaseAdmin, missingSupabaseAdminEnv } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

// NYC neighbourhood/borough patterns — no LLM needed for these
const NYC_PATTERN =
  /\b(nyc|new york(?: city)?|manhattan|brooklyn|queens|bronx|staten island|east village|west village|williamsburg|bushwick|astoria|harlem|soho|tribeca|midtown|upper (?:east|west) side|lower east side|hell'?s kitchen|les|ues|uws|jersey city|hoboken|fidi|financial district|greenpoint|park slope|dumbo|crown heights|bed.?stuy|bedford.?stuyvesant|ridgewood|sunnyside|long island city|lic|inwood|washington heights|murray hill|kips bay|gramercy|nolita|noho|chelsea|flatiron|boerum hill|cobble hill|carroll gardens|red hook|fort greene|prospect heights|prospect park|bay ridge|bensonhurst|flushing|jackson heights|rego park|forest hills|jamaica|riverdale|morningside heights|columbia|upper manhattan|lower manhattan|downtown brooklyn|north brooklyn|south brooklyn)\b/i;

async function extractCityFromText(text: string): Promise<string | null> {
  if (!text.trim()) return null;

  // Fast path: known NYC locations
  const nycMatch = text.match(NYC_PATTERN);
  if (nycMatch) {
    const matched = nycMatch[0].toLowerCase();
    if (matched === "nyc" || matched === "new york" || matched === "new york city") return "nyc";
    return matched;
  }

  // LLM fallback
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "Extract the city or neighbourhood the person lives in from this SMS conversation. " +
              "Return JSON: {\"city\": \"<city or null>\"}. " +
              "If no location is mentioned return null. Normalise 'New York City' / 'NYC' to 'nyc'. Keep neighbourhoods as-is.",
          },
          { role: "user", content: text.slice(0, 3000) },
        ],
        max_completion_tokens: 40,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { city?: string | null };
    return parsed.city?.trim() || null;
  } catch {
    return null;
  }
}

async function fetchSmsText(supabase: SupabaseAdmin, phone: string): Promise<string | null> {
  const { data: convs } = await supabase
    .from("sms_conversations")
    .select("id")
    .eq("participant_phone_e164", phone)
    .limit(3);

  if (!convs?.length) return null;

  const convIds = convs.map((c) => c.id);
  const { data: msgs } = await supabase
    .from("sms_messages")
    .select("body")
    .in("conversation_id", convIds)
    .eq("direction", "inbound")
    .order("created_at", { ascending: true })
    .limit(30);

  if (!msgs?.length) return null;

  const text = msgs
    .map((m) => String((m as { body?: unknown }).body ?? ""))
    .filter(Boolean)
    .join("\n");

  return text.slice(0, 3000) || null;
}

export async function POST(request: Request) {
  const auth = await verifyAdminApiRequest(request);
  if (!auth.ok) return auth.response;

  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0)
    return NextResponse.json({ error: `Server misconfigured: missing ${missing.join(", ")}` }, { status: 503 });

  const enc = new TextEncoder();
  const supabase = getSupabaseAdmin();

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      }

      try {
        // All profiles with no city — include both with and without intro_reply_raw
        const { data, error } = await supabase
          .from("onboarding_profiles")
          .select("id, phone_e164, intro_reply_raw")
          .is("city", null);

        if (error) {
          send({ stage: "error", message: error.message });
          controller.close();
          return;
        }

        const rows = (data ?? []) as { id: string; phone_e164: string; intro_reply_raw: string | null }[];
        send({ stage: "start", total: rows.length, message: `Found ${rows.length} profiles without city` });

        let updated = 0;
        let skipped = 0;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          let city: string | null = null;

          // 1. Try intro_reply_raw (fast path — NYC regex, then LLM)
          if (row.intro_reply_raw) {
            city = await extractCityFromText(row.intro_reply_raw);
          }

          // 2. Fallback: scan their SMS conversation
          if (!city && row.phone_e164) {
            const smsText = await fetchSmsText(supabase, row.phone_e164);
            if (smsText) {
              city = await extractCityFromText(smsText);
            }
          }

          if (city) {
            await supabase.from("onboarding_profiles").update({ city }).eq("id", row.id);
            updated++;
          } else {
            skipped++;
          }

          if ((i + 1) % 5 === 0 || i === rows.length - 1) {
            send({
              stage: "progress",
              processed: i + 1,
              total: rows.length,
              updated,
              skipped,
              message: `${i + 1} / ${rows.length} · ${updated} updated · ${skipped} skipped`,
            });
          }
        }

        send({
          stage: "done",
          updated,
          skipped,
          total: rows.length,
          message: `Done — ${updated} updated of ${rows.length}`,
        });
      } catch (e) {
        send({ stage: "error", message: e instanceof Error ? e.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
