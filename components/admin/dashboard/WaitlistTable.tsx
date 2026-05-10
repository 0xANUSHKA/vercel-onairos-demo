"use client";

import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type WaitlistRow = {
  id?: string | number;
  value?: string;
  type?: string;
  city?: string;
  onairos_completion?: unknown;
  onairos_traits?: unknown;
  onairos_traits_status?: string | null;
  is_18_plus?: boolean;
  terms_accepted?: boolean;
  sms_consent?: boolean;
  liability_understood?: boolean;
  created_at?: string;
  /** From /api/admin/waitlist when an onboarding row exists for this waitlist id */
  onboarding_profile_id?: string | null;
};

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function onairosStatusLabel(status?: string | null): string {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "pending") return "Pending";
  if (s === "processing") return "Processing";
  if (s === "complete") return "Complete";
  if (s === "failed") return "Failed";
  return "—";
}

function onairosStatusClassName(status?: string | null): string {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "pending") {
    return "bg-warning-50 text-warning-700 dark:bg-warning-500/20 dark:text-warning-300";
  }
  if (s === "processing") {
    return "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/20 dark:text-blue-light-300";
  }
  if (s === "complete") {
    return "bg-success-50 text-success-700 dark:bg-success-500/20 dark:text-success-300";
  }
  if (s === "failed") {
    return "bg-error-50 text-error-700 dark:bg-error-500/20 dark:text-error-300";
  }
  return "bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-300";
}

export default function WaitlistTable() {
  const router = useRouter();
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [emptyHint, setEmptyHint] = useState<string | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [smsInfo, setSmsInfo] = useState<string | null>(null);
  const [smsSending, setSmsSending] = useState(false);
  const [sentPopupText, setSentPopupText] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removeInfo, setRemoveInfo] = useState<string | null>(null);
  const [banning, setBanning] = useState(false);
  const [banError, setBanError] = useState<string | null>(null);
  const [banInfo, setBanInfo] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  /** DB-wide waitlist-only count (no participant); not limited to loaded rows. */
  const [waitlistActiveOnlyTotal, setWaitlistActiveOnlyTotal] = useState<number | null>(null);

  const rowKey = useCallback((row: WaitlistRow, index: number) => {
    if (row.id != null) return `id:${String(row.id)}`;
    return `idx:${index}:${row.value ?? ""}:${row.created_at ?? ""}`;
  }, []);

  const fetchRows = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setEmptyHint(null);

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      setError("You are not authenticated. Please sign in again.");
      setRows([]);
      setWaitlistActiveOnlyTotal(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const response = await fetch("/api/admin/waitlist", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      cache: "no-store",
    });

    const payload = (await response.json()) as {
      data?: WaitlistRow[];
      waitlist_active_only_count?: number;
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Failed to fetch waitlist.");
      setRows([]);
      setWaitlistActiveOnlyTotal(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setWaitlistActiveOnlyTotal(
      typeof payload.waitlist_active_only_count === "number" ? payload.waitlist_active_only_count : null
    );
    const data = (payload.data ?? []).filter((row) => !row.onboarding_profile_id);
    setRows(data);
    setSelectedRowKeys(new Set());
    if (data.length === 0) {
      setEmptyHint("No waitlist entries found.");
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const value = row.value?.toLowerCase() ?? "";
      const city = row.city?.toLowerCase() ?? "";
      const type = row.type?.toLowerCase() ?? "";
      return value.includes(q) || city.includes(q) || type.includes(q);
    });
  }, [rows, query]);

  const filteredKeys = useMemo(
    () => filteredRows.map((row, index) => rowKey(row, index)),
    [filteredRows, rowKey]
  );

  const selectedVisibleCount = useMemo(
    () => filteredKeys.filter((key) => selectedRowKeys.has(key)).length,
    [filteredKeys, selectedRowKeys]
  );
  const selectedVisibleRows = useMemo(
    () =>
      filteredRows.filter((row, index) => {
        const key = rowKey(row, index);
        return selectedRowKeys.has(key);
      }),
    [filteredRows, rowKey, selectedRowKeys]
  );

  const allVisibleSelected =
    filteredKeys.length > 0 && selectedVisibleCount === filteredKeys.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  const toggleRow = useCallback((key: string, checked: boolean) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(
    (checked: boolean) => {
      setSelectedRowKeys((prev) => {
        const next = new Set(prev);
        for (const key of filteredKeys) {
          if (checked) next.add(key);
          else next.delete(key);
        }
        return next;
      });
    },
    [filteredKeys]
  );

  const sendSmsToSelected = useCallback(async () => {
    setSmsError(null);
    setSmsInfo(null);
    if (selectedVisibleRows.length === 0) return;

    const numbers = selectedVisibleRows
      .map((r) => (r.value ?? "").trim())
      .filter(Boolean);

    if (numbers.length === 0) {
      setSmsError("No phone numbers in selected rows.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setSmsError("You are not authenticated. Please sign in again.");
      return;
    }

    setSmsSending(true);
    try {
      const results = await Promise.allSettled(
        numbers.map(async (to) => {
          const res = await fetch("/api/admin/sms/start-onboarding", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ to }),
          });
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) {
            throw new Error(payload.error ?? `Failed to start onboarding for ${to}`);
          }
          return to;
        })
      );
      const okCount = results.filter((r) => r.status === "fulfilled").length;
      const failCount = results.length - okCount;
      const sentNumbers = results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
        .map((r) => r.value);
      setSmsInfo(`Onboarding started for ${okCount} recipient${okCount === 1 ? "" : "s"}.`);
      if (failCount > 0) {
        setSmsError(`${failCount} start request${failCount === 1 ? "" : "s"} failed.`);
      }
      if (okCount > 0) {
        setSentPopupText(
          `Sent message${okCount === 1 ? "" : "s"} to ${okCount} recipient${okCount === 1 ? "" : "s"}.`
        );
        setRows((prev) => prev.filter((row) => !sentNumbers.includes((row.value ?? "").trim())));
        setSelectedRowKeys(new Set());
        setTimeout(() => setSentPopupText(null), 2200);
        await fetchRows(true);
      }
    } catch (e) {
      setSmsError(e instanceof Error ? e.message : "Failed to start onboarding.");
    } finally {
      setSmsSending(false);
    }
  }, [fetchRows, selectedVisibleRows]);

  const banSmsForSelected = useCallback(async () => {
    setBanError(null);
    setBanInfo(null);
    if (selectedVisibleRows.length === 0) return;

    const numbers = selectedVisibleRows
      .map((r) => (r.value ?? "").trim())
      .filter(Boolean);

    if (numbers.length === 0) {
      setBanError("No phone numbers in selected rows.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setBanError("You are not authenticated. Please sign in again.");
      return;
    }

    const ok = window.confirm(
      `Ban ${numbers.length} phone number${numbers.length === 1 ? "" : "s"} from SMS + new waitlist joins? They can still reply STOP if listed.`
    );
    if (!ok) return;

    setBanning(true);
    try {
      const results = await Promise.allSettled(
        numbers.map(async (phone_e164) => {
          const res = await fetch("/api/admin/sms-phone-bans", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ phone_e164, reason: "admin waitlist ban" }),
          });
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) {
            throw new Error(payload.error ?? `Failed to ban ${phone_e164}`);
          }
          return phone_e164;
        })
      );
      const okCount = results.filter((r) => r.status === "fulfilled").length;
      const failCount = results.length - okCount;
      setBanInfo(`Banned ${okCount} number${okCount === 1 ? "" : "s"} for SMS / join API.`);
      if (failCount > 0) {
        setBanError(`${failCount} ban request${failCount === 1 ? "" : "s"} failed.`);
      }
      setSelectedRowKeys(new Set());
    } catch (e) {
      setBanError(e instanceof Error ? e.message : "Failed to ban numbers.");
    } finally {
      setBanning(false);
    }
  }, [selectedVisibleRows]);

  const removeSelected = useCallback(async () => {
    setRemoveError(null);
    setRemoveInfo(null);
    if (selectedVisibleRows.length === 0) return;

    const ids = selectedVisibleRows
      .map((r) => (r.id != null ? String(r.id) : ""))
      .filter(Boolean);

    if (ids.length === 0) {
      setRemoveError("Selected rows are missing IDs.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setRemoveError("You are not authenticated. Please sign in again.");
      return;
    }

    const ok = window.confirm(
      `Remove ${ids.length} waitlist entr${ids.length === 1 ? "y" : "ies"}? This cannot be undone.`
    );
    if (!ok) return;

    setRemoving(true);
    try {
      const response = await fetch("/api/admin/waitlist", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ waitlist_ids: ids }),
      });

      const payload = (await response.json()) as {
        deleted_count?: number;
        skipped_onboarding_ids?: string[];
        error?: string;
      };
      if (!response.ok) {
        setRemoveError(payload.error ?? "Failed to remove waitlist entries.");
        return;
      }

      const deleted = payload.deleted_count ?? 0;
      const skipped = payload.skipped_onboarding_ids?.length ?? 0;
      setRemoveInfo(
        `Removed ${deleted} entr${deleted === 1 ? "y" : "ies"}${
          skipped > 0 ? ` · skipped ${skipped} linked to participants` : ""
        }.`
      );
      await fetchRows(true);
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Failed to remove waitlist entries.");
    } finally {
      setRemoving(false);
    }
  }, [fetchRows, selectedVisibleRows]);

  const openOnboarding = useCallback(
    async (row: WaitlistRow) => {
      setOnboardingError(null);
      if (row.onboarding_profile_id) {
        router.push(`/admin/participants/${row.onboarding_profile_id}`);
        return;
      }
      if (row.id == null) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setOnboardingError("Not signed in.");
        return;
      }
      const res = await fetch("/api/admin/profiles", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ waitlist_id: String(row.id) }),
      });
      const payload = (await res.json()) as { data?: { id: string }; error?: string };
      if (!res.ok || !payload.data?.id) {
        setOnboardingError(payload.error ?? "Could not create participant.");
        return;
      }
      router.push(`/admin/participants/${payload.data.id}`);
    },
    [router]
  );

  return (
    <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Waitlist Entries
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              Waitlist only (no participant yet):{" "}
              {waitlistActiveOnlyTotal != null ? waitlistActiveOnlyTotal.toLocaleString() : "—"}
            </span>
            {query.trim()
              ? ` · ${filteredRows.length} result${filteredRows.length === 1 ? "" : "s"} matching search`
              : ""}
            {selectedVisibleCount > 0 ? ` · ${selectedVisibleCount} selected` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search value, city, type"
            className="h-10 w-full min-w-[220px] rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
          />
          <button
            type="button"
            onClick={() => fetchRows(true)}
            disabled={refreshing || loading}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {onboardingError && (
        <div className="border-b border-gray-100 px-5 py-2 text-sm text-error-500 dark:border-gray-800">
          {onboardingError}
        </div>
      )}
      {smsError && (
        <div className="border-b border-gray-100 px-5 py-2 text-sm text-error-500 dark:border-gray-800">
          {smsError}
        </div>
      )}
      {smsInfo && (
        <div className="border-b border-gray-100 px-5 py-2 text-sm text-success-600 dark:border-gray-800">
          {smsInfo}
        </div>
      )}
      {sentPopupText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-sm rounded-xl border border-success-200 bg-white p-5 text-center shadow-xl dark:border-success-800 dark:bg-gray-900">
            <p className="text-base font-semibold text-success-700 dark:text-success-300">
              Message sent
            </p>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{sentPopupText}</p>
            <button
              type="button"
              onClick={() => setSentPopupText(null)}
              className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-success-600 px-4 text-sm font-medium text-white hover:bg-success-700"
            >
              Close
            </button>
          </div>
        </div>
      )}
      {removeError && (
        <div className="border-b border-gray-100 px-5 py-2 text-sm text-error-500 dark:border-gray-800">
          {removeError}
        </div>
      )}
      {removeInfo && (
        <div className="border-b border-gray-100 px-5 py-2 text-sm text-success-600 dark:border-gray-800">
          {removeInfo}
        </div>
      )}
      {banError && (
        <div className="border-b border-gray-100 px-5 py-2 text-sm text-error-500 dark:border-gray-800">{banError}</div>
      )}
      {banInfo && (
        <div className="border-b border-gray-100 px-5 py-2 text-sm text-success-600 dark:border-gray-800">{banInfo}</div>
      )}
      {loading ? (
        <div className="px-5 py-8 text-sm text-gray-500 dark:text-gray-400">Loading waitlist...</div>
      ) : error ? (
        <div className="px-5 py-8 text-sm text-error-500">Failed to load waitlist: {error}</div>
      ) : filteredRows.length === 0 ? (
        <div className="px-5 py-8 text-sm text-gray-500 dark:text-gray-400">
          {emptyHint ?? "No waitlist entries found."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex items-center justify-end px-5 py-3">
            <button
              type="button"
              onClick={() => void banSmsForSelected()}
              disabled={selectedVisibleCount === 0 || banning}
              className="mr-2 inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              {banning
                ? "Banning..."
                : `Ban SMS${selectedVisibleCount > 0 ? ` (${selectedVisibleCount})` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => void removeSelected()}
              disabled={selectedVisibleCount === 0 || removing}
              className="mr-2 inline-flex h-9 items-center justify-center rounded-lg bg-error-500 px-3 text-sm font-medium text-white transition hover:bg-error-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {removing
                ? "Removing..."
                : `Remove${selectedVisibleCount > 0 ? ` (${selectedVisibleCount})` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => void sendSmsToSelected()}
              disabled={selectedVisibleCount === 0 || smsSending}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-success-600 px-3 text-sm font-medium text-white transition hover:bg-success-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {smsSending
                ? "Starting..."
                : `Start Conversation${selectedVisibleCount > 0 ? ` (${selectedVisibleCount})` : ""}`}
            </button>
          </div>
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="px-5 py-3 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all filtered waitlist rows"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={(e) => toggleAllVisible(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                </th>
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
                  Consents
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Created
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Traits sync
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Onboarding
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                (() => {
                  const key = rowKey(row, index);
                  const checked = selectedRowKeys.has(key);
                  return (
                <tr
                  key={key}
                  className="border-b border-gray-100 last:border-b-0 dark:border-gray-800"
                >
                  <td className="px-5 py-4 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`Select waitlist row ${row.value ?? index + 1}`}
                      checked={checked}
                      onChange={(e) => toggleRow(key, e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-200">{row.value || "—"}</td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{row.type || "—"}</td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">{row.city || "—"}</td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                    <div className="flex flex-wrap gap-1">
                      {row.is_18_plus && (
                        <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-500/20 dark:text-success-300">
                          18+
                        </span>
                      )}
                      {row.terms_accepted && (
                        <span className="rounded-full bg-blue-light-50 px-2 py-0.5 text-xs font-medium text-blue-light-700 dark:bg-blue-light-500/20 dark:text-blue-light-300">
                          Terms
                        </span>
                      )}
                      {row.sms_consent && (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                          SMS
                        </span>
                      )}
                      {row.liability_understood && (
                        <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-500/20 dark:text-warning-300">
                          Liability
                        </span>
                      )}
                      {!row.is_18_plus &&
                        !row.terms_accepted &&
                        !row.sms_consent &&
                        !row.liability_understood && <span>—</span>}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                    {formatDate(row.created_at)}
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                    {row.onairos_completion != null ? (
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${onairosStatusClassName(
                          row.onairos_traits_status
                        )}`}
                      >
                        {onairosStatusLabel(row.onairos_traits_status)}
                      </span>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-sm">
                    <button
                      type="button"
                      onClick={() => void openOnboarding(row)}
                      className="font-medium text-[#0e9f6e] hover:underline"
                    >
                      {row.onboarding_profile_id ? "Open" : "Start"}
                    </button>
                  </td>
                </tr>
                  );
                })()
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
