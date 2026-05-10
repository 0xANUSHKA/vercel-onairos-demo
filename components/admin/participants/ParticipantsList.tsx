"use client";

import { BanSmsPhoneButton } from "@/components/admin/BanSmsPhoneButton";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type WaitlistInfo = { id: string; value: string; city?: string; created_at?: string };

type ProfileRow = {
  id: string;
  phone_e164: string;
  gender: string | null;
  display_name: string | null;
  age: number | null;
  height: string | null;
  updated_at?: string;
  waitlist: WaitlistInfo | null;
};

type WaitlistRow = { id?: string; value?: string; city?: string; created_at?: string };

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default function ParticipantsList() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [banNotice, setBanNotice] = useState<string | null>(null);

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
    const [pRes, wRes] = await Promise.all([
      fetch("/api/admin/profiles", { headers: h, cache: "no-store" }),
      fetch("/api/admin/waitlist", { headers: h, cache: "no-store" }),
    ]);

    const pJson = (await pRes.json()) as { data?: ProfileRow[]; error?: string };
    const wJson = (await wRes.json()) as { data?: WaitlistRow[]; error?: string };

    if (!pRes.ok) {
      setError(pJson.error ?? "Failed to load participants.");
      setProfiles([]);
    } else {
      setProfiles(pJson.data ?? []);
    }

    if (wRes.ok) {
      setWaitlist(wJson.data ?? []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const usedWaitlistIds = useMemo(
    () => new Set(profiles.map((p) => p.waitlist?.id).filter(Boolean) as string[]),
    [profiles]
  );

  const availableWaitlist = useMemo(() => {
    return waitlist.filter((w) => w.id && !usedWaitlistIds.has(String(w.id)));
  }, [waitlist, usedWaitlistIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => {
      const phone = p.phone_e164.toLowerCase();
      const name = p.display_name?.toLowerCase() ?? "";
      const g = p.gender?.toLowerCase() ?? "";
      return phone.includes(q) || name.includes(q) || g.includes(q);
    });
  }, [profiles, query]);

  async function createFromWaitlist(waitlistId: string) {
    if (!waitlistId) return;
    setCreating(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError("Not authenticated.");
      setCreating(false);
      return;
    }
    const res = await fetch("/api/admin/profiles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ waitlist_id: waitlistId }),
    });
    const payload = (await res.json()) as { data?: ProfileRow; error?: string };
    if (!res.ok) {
      setError(payload.error ?? "Could not create profile.");
      setCreating(false);
      return;
    }
    if (payload.data) setProfiles((prev) => [payload.data as ProfileRow, ...prev]);
    setCreating(false);
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            All profiles (in progress and complete). Use the sidebar for{" "}
            <span className="whitespace-nowrap">Male / Female (complete)</span> after every question is filled.
          </p>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Participants</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by phone, name, gender"
            className="min-w-[12rem] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-[#0e9f6e] focus:outline-none dark:border-gray-700 dark:bg-gray-900/40 dark:text-white/90"
          />
          {availableWaitlist.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="add-wl" className="text-xs text-gray-500 dark:text-gray-400">
                New from waitlist
              </label>
              <select
                id="add-wl"
                defaultValue=""
                disabled={creating}
                onChange={(e) => {
                  const v = e.target.value;
                  e.target.value = "";
                  if (v) void createFromWaitlist(v);
                }}
                className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/40"
              >
                <option value="">— select —</option>
                {availableWaitlist.map((w) => (
                  <option key={String(w.id)} value={String(w.id)}>
                    {w.value ?? w.id} {w.city ? `(${w.city})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        {loading && (
          <div className="px-5 py-8 text-sm text-gray-500 dark:text-gray-400">Loading…</div>
        )}
        {!loading && error && (
          <div className="px-5 py-8 text-sm text-error-500">{error}</div>
        )}
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
            No participants yet. Use the dropdown above, or go to Waitlist and use Start / Open, then add
            answers in order (intro = sort order 1 in Questions for each track).
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <table className="min-w-full text-left text-sm text-gray-700 dark:text-white/80">
            <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
              <tr>
                <th className="px-5 py-3">Phone</th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Gender</th>
                <th className="px-5 py-3">Updated</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50/80 dark:hover:bg-white/[0.04]">
                  <td className="px-5 py-3 font-mono text-xs sm:text-sm">{p.phone_e164}</td>
                  <td className="px-5 py-3">{p.display_name ?? "—"}</td>
                  <td className="px-5 py-3">{p.gender ?? "—"}</td>
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
                        href={`/admin/participants/${p.id}`}
                        className="text-sm font-medium text-[#0e9f6e] hover:underline"
                      >
                        Open
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
