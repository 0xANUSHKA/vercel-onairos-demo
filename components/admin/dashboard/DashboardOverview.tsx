"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useMemo, useState } from "react";

type WaitlistRow = {
  value?: string;
  type?: string;
  city?: string;
  created_at?: string;
  onboarding_profile_id?: string | null;
};

export default function DashboardOverview() {
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  /** `COUNT(*)` on `waitlist` — all-time signups (Phone Entries). */
  const [waitlistAllSignupsTotal, setWaitlistAllSignupsTotal] = useState<number | null>(null);
  /** Waitlist rows with no onboarding profile (same as admin Waitlist page). */
  const [waitlistActiveOnlyTotal, setWaitlistActiveOnlyTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        if (!active) return;
        setError("You are not authenticated.");
        setLoading(false);
        return;
      }

      const response = await fetch("/api/admin/waitlist", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        data?: WaitlistRow[];
        waitlist_total_count?: number;
        waitlist_active_only_count?: number;
        error?: string;
      };

      if (!active) return;
      if (!response.ok) {
        setError(payload.error ?? "Failed to load dashboard data.");
        setLoading(false);
        return;
      }

      const fetchedRows = payload.data ?? [];
      const activeRows = fetchedRows.filter((row) => !row.onboarding_profile_id);
      setRows(activeRows);
      setWaitlistAllSignupsTotal(
        typeof payload.waitlist_total_count === "number" ? payload.waitlist_total_count : null
      );
      setWaitlistActiveOnlyTotal(
        typeof payload.waitlist_active_only_count === "number" ? payload.waitlist_active_only_count : null
      );
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const stats = useMemo(() => {
    const uniqueCities = new Set(rows.map((r) => (r.city ?? "").trim()).filter(Boolean)).size;
    const today = new Date();
    const todayCount = rows.filter((r) => {
      if (!r.created_at) return false;
      const d = new Date(r.created_at);
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    }).length;

    return { uniqueCities, todayCount };
  }, [rows]);

  const latest = useMemo(() => rows.slice(0, 8), [rows]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
        Loading dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-error-500 dark:border-gray-800 dark:bg-white/[0.02]">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-sm text-gray-500 dark:text-gray-400">Waitlist only (no participant yet)</p>
          <p className="mt-1 text-lg font-semibold text-gray-800 dark:text-white/90">
            {waitlistActiveOnlyTotal != null ? waitlistActiveOnlyTotal.toLocaleString() : "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-sm text-gray-500 dark:text-gray-400">Today</p>
          <p className="mt-1 text-lg font-semibold text-gray-800 dark:text-white/90">{stats.todayCount}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-sm text-gray-500 dark:text-gray-400">Phone Entries</p>
          <p className="mt-1 text-lg font-semibold text-gray-800 dark:text-white/90">
            {waitlistAllSignupsTotal != null ? waitlistAllSignupsTotal.toLocaleString() : "—"}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">All-time waitlist signups</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-sm text-gray-500 dark:text-gray-400">Unique Cities</p>
          <p className="mt-1 text-lg font-semibold text-gray-800 dark:text-white/90">{stats.uniqueCities}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Latest Entries</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Most recent waitlist data points</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Contact
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Type
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  City
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {latest.length === 0 ? (
                <tr>
                  <td className="px-5 py-5 text-sm text-gray-500 dark:text-gray-400" colSpan={4}>
                    No entries yet.
                  </td>
                </tr>
              ) : (
                latest.map((row, index) => (
                  <tr key={`${row.value ?? "row"}-${index}`} className="border-b border-gray-100 last:border-b-0 dark:border-gray-800">
                    <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-200">{row.value || "—"}</td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{row.type || "—"}</td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{row.city || "—"}</td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
