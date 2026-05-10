"use client";

import { BanSmsPhoneButton } from "@/components/admin/BanSmsPhoneButton";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Gender = "MALE" | "FEMALE";

type WaitlistInfo = { id: string; value: string; city?: string; created_at?: string };

type ProfileRow = {
  id: string;
  phone_e164: string;
  gender: string | null;
  display_name: string | null;
  age: number | null;
  height: string | null;
  city: string | null;
  updated_at?: string;
  waitlist: WaitlistInfo | null;
};

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function isNyc(city: string | null): boolean {
  if (!city) return false;
  const c = city.toLowerCase();
  return (
    c === "nyc" ||
    c.includes("new york") ||
    c.includes("manhattan") ||
    c.includes("brooklyn") ||
    c.includes("queens") ||
    c.includes("bronx") ||
    c.includes("staten island") ||
    c.includes("williamsburg") ||
    c.includes("east village") ||
    c.includes("west village") ||
    c.includes("bushwick") ||
    c.includes("astoria") ||
    c.includes("harlem") ||
    c.includes("soho") ||
    c.includes("tribeca") ||
    c.includes("jersey city") ||
    c.includes("hoboken")
  );
}

const titles: Record<Gender, { title: string; description: string }> = {
  MALE: {
    title: "Male participants (complete)",
    description:
      "Shows male participants who finished onboarding, plus anyone with at least one uploaded image answer.",
  },
  FEMALE: {
    title: "Female participants (complete)",
    description:
      "Shows female participants who finished onboarding, plus anyone with at least one uploaded image answer.",
  },
};

export default function CompletedParticipantsList({ track }: { track: Gender }) {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [nycOnly, setNycOnly] = useState(false);
  const [banNotice, setBanNotice] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);

  const fromParam = track === "MALE" ? "complete_male" : "complete_female";
  const meta = titles[track];

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError("You are not authenticated. Please sign in again.");
      setLoading(false);
      return;
    }
    const h = { Authorization: `Bearer ${session.access_token}` };
    const pRes = await fetch(`/api/admin/profiles/completed?gender=${track}`, {
      headers: h,
      cache: "no-store",
    });
    const pJson = (await pRes.json()) as { data?: ProfileRow[]; error?: string };
    if (!pRes.ok) {
      setError(pJson.error ?? "Failed to load participants.");
      setProfiles([]);
    } else {
      setProfiles(pJson.data ?? []);
    }
    setLoading(false);
  }, [track]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    let list = profiles;
    if (nycOnly) list = list.filter((p) => isNyc(p.city));
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => {
      const phone = p.phone_e164.toLowerCase();
      const name = p.display_name?.toLowerCase() ?? "";
      const city = p.city?.toLowerCase() ?? "";
      return phone.includes(q) || name.includes(q) || city.includes(q);
    });
  }, [profiles, query, nycOnly]);

  const nycCount = useMemo(() => profiles.filter((p) => isNyc(p.city)).length, [profiles]);
  const missingCityCount = useMemo(() => profiles.filter((p) => !p.city).length, [profiles]);

  async function runBackfill() {
    setBackfilling(true);
    setBackfillResult(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { setBackfilling(false); return; }
    try {
      const res = await fetch("/api/admin/profiles/backfill-city", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.body) { setBackfillResult("No response stream."); setBackfilling(false); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as { stage: string; message?: string };
            if (data.message) setBackfillResult(data.message);
            if (data.stage === "done") void fetchData();
          } catch { /* malformed line */ }
        }
      }
    } catch {
      setBackfillResult("Backfill failed.");
    }
    setBackfilling(false);
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between dark:border-gray-800">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-gray-500 dark:text-gray-400">{meta.description}</p>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">{meta.title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {profiles.length} total · {nycCount} NYC
            {query.trim() || nycOnly ? ` · ${filtered.length} shown` : ""}
          </p>
          {missingCityCount > 0 && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {missingCityCount} profile{missingCityCount === 1 ? "" : "s"} missing city
              </span>
              <button
                type="button"
                onClick={() => void runBackfill()}
                disabled={backfilling}
                className="rounded px-2 py-0.5 text-xs font-medium text-[#0e9f6e] hover:underline disabled:opacity-50"
              >
                {backfilling ? "Backfilling…" : "Backfill city"}
              </button>
              {backfillResult && (
                <span className="text-xs text-gray-500 dark:text-gray-400">{backfillResult}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setNycOnly((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              nycOnly
                ? "border-[#0e9f6e] bg-[#0e9f6e] text-white"
                : "border-gray-200 bg-white text-gray-700 hover:border-[#0e9f6e] dark:border-gray-700 dark:bg-gray-900/40 dark:text-white/80"
            }`}
          >
            NYC only
          </button>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by phone, name, city"
            className="min-w-[14rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-[#0e9f6e] focus:outline-none dark:border-gray-700 dark:bg-gray-900/40 dark:text-white/90"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        {loading && (
          <div className="px-5 py-8 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
        )}
        {!loading && error && <div className="px-5 py-8 text-sm text-error-500">{error}</div>}
        {!loading && banNotice && (
          <div className="flex items-center justify-between gap-3 border-b border-green-100 bg-green-50 px-5 py-2 text-sm text-green-800 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">
            <span>{banNotice}</span>
            <button
              type="button"
              onClick={() => setBanNotice(null)}
              className="shrink-0 text-xs font-medium text-green-700 underline hover:no-underline dark:text-green-300"
            >
              Dismiss
            </button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="px-5 py-8 text-sm text-gray-500 dark:text-gray-400">
            {nycOnly ? (
              <>No NYC profiles found. Try turning off the NYC filter.</>
            ) : (
              <>
                No {track === "MALE" ? "male" : "female"} participants are completed yet and no uploaded image answers were
                found. Check the main{" "}
                <Link href="/admin/participants" className="text-[#0e9f6e] hover:underline">
                  Participants
                </Link>{" "}
                list first.
              </>
            )}
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <table className="min-w-full text-left text-sm text-gray-700 dark:text-white/80">
            <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
              <tr>
                <th className="px-5 py-3">Phone</th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">City</th>
                <th className="px-5 py-3">Updated</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50/80 dark:hover:bg-white/[0.04]">
                  <td className="px-5 py-3 font-mono text-xs sm:text-sm">{p.phone_e164}</td>
                  <td className="px-5 py-3">{p.display_name ?? "—"}</td>
                  <td className="px-5 py-3">
                    {p.city ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          isNyc(p.city)
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {p.city}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">
                    {formatDate(p.updated_at)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                      <BanSmsPhoneButton
                        phoneE164={p.phone_e164}
                        onBanned={() => setBanNotice(`Banned ${p.phone_e164} from SMS and new waitlist joins.`)}
                      />
                      <Link
                        href={`/admin/participants/${p.id}?from=${fromParam}`}
                        className="text-sm font-medium text-[#0e9f6e] hover:underline"
                      >
                        Open · update choices
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
