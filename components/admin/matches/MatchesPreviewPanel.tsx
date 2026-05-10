"use client";

import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { MatchViewModal } from "./MatchViewModal";

type MatchScore = {
  user_a_id: string;
  user_b_id: string;
  score: number;
  reasons: string[];
  reasoning?: Record<string, string> | null;
  risks?: string[] | null;
  suggested_intro_hook?: string | null;
  dimensions?: {
    lifestyle?: number;
    values?: number;
    personality?: number;
    energy?: number;
    communication?: number;
  } | null;
};

type UserListItem = {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
};

type PairMatchResult = {
  score: number;
  reasons: string[];
  reasoning?: Record<string, string> | null;
  risks?: string[] | null;
  suggested_intro_hook?: string | null;
  dimensions?: {
    lifestyle?: number;
    values?: number;
    personality?: number;
    energy?: number;
    communication?: number;
  } | null;
};

type PairResponse = {
  pair_mode: true;
  user_a: UserListItem;
  user_b: UserListItem;
  match: PairMatchResult;
  model_usage?: { embeddings_model?: string; llm_scoring?: string };
  error?: string;
};

type PreviewResponse = {
  dry_run: boolean;
  notifications_sent: boolean;
  persisted: boolean;
  user_count: number;
  model_usage?: {
    embeddings_model?: string;
    llm_scoring?: string;
  };
  users_by_id?: Record<
    string,
    {
      name?: string;
      age?: number | null;
      gender?: string | null;
    }
  >;
  rankings: Record<string, MatchScore[]>;
};

type MatchRow = {
  pairKey: string;
  userAId: string;
  userBId: string;
  userAName: string;
  userBName: string;
  userAAge: number | null;
  userBAge: number | null;
  userAGender: string;
  userBGender: string;
  matchLabel: string;
  score: number;
  reasons: string[];
  reasoning?: Record<string, string> | null;
  risks?: string[] | null;
  suggested_intro_hook?: string | null;
  dimensions?: {
    lifestyle?: number;
    values?: number;
    personality?: number;
    energy?: number;
    communication?: number;
  } | null;
  isManual?: boolean;
};

type ActionState = "idle" | "approving" | "rejecting" | "approved" | "rejected";

type SelectOption = { value: string; label: string; disabled?: boolean };

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "— select —",
}: {
  options: SelectOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  function openDropdown() {
    setOpen(true);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function select(val: string, disabled?: boolean) {
    if (disabled) return;
    onChange(val);
    setOpen(false);
    setQuery("");
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={openDropdown}
        className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
      >
        <span className={value ? "text-gray-800 dark:text-white/90" : "text-gray-400 dark:text-gray-500"}>
          {value ? selectedLabel : placeholder}
        </span>
        <svg className="ml-2 h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0e9f6e] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white/90"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto pb-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
            ) : (
              filtered.map((opt) => (
                <li key={opt.value}>
                  <button
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => select(opt.value, opt.disabled)}
                    className={`w-full px-3 py-2 text-left text-sm transition ${
                      opt.value === value
                        ? "bg-[#0e9f6e]/10 font-medium text-[#0e9f6e]"
                        : opt.disabled
                        ? "cursor-not-allowed text-gray-300 dark:text-gray-600"
                        : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"
                    }`}
                  >
                    {opt.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending_review:       { label: "pending",          className: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400" },
  approved:             { label: "approved",          className: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" },
  awaiting_responses:   { label: "waiting · both",   className: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  awaiting_one_response:{ label: "waiting · one",    className: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  mutual_yes:           { label: "mutual yes",        className: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  introduced:           { label: "connected 🎉",      className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" },
  declined:             { label: "declined",          className: "bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400" },
  rejected_by_founder:  { label: "rejected",          className: "bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400" },
  expired:              { label: "expired",           className: "bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, className: "bg-gray-100 text-gray-500" };
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function toPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function dimLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export default function MatchesPreviewPanel() {
  // ── Dry-run state ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResponse | null>(null);

  // ── Pair-score state ───────────────────────────────────────────────────────
  const [userList, setUserList] = useState<UserListItem[]>([]);
  const [selectedA, setSelectedA] = useState("");
  const [selectedB, setSelectedB] = useState("");
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [manualRows, setManualRows] = useState<MatchRow[]>([]);

  // ── Action state ───────────────────────────────────────────────────────────
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [matchStatuses, setMatchStatuses] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Expandable rows ────────────────────────────────────────────────────────
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // ── View modal ─────────────────────────────────────────────────────────────
  const [viewRow, setViewRow] = useState<MatchRow | null>(null);

  // ── Best-unique toggle ─────────────────────────────────────────────────────
  const [uniqueOnly, setUniqueOnly] = useState(false);
  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch("/api/admin/matches/preview", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { users?: UserListItem[] };
      setUserList(data.users ?? []);
    })();
  }, []);

  async function scorePair() {
    if (!selectedA || !selectedB) return;
    setPairLoading(true);
    setPairError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setPairError("Not authenticated.");
        return;
      }
      const res = await fetch("/api/admin/matches/preview", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userAId: selectedA, userBId: selectedB }),
      });
      const data = (await res.json()) as PairResponse;
      if (!res.ok) {
        setPairError(data.error ?? "Scoring failed.");
        return;
      }

      // Convert PairResponse → MatchRow and merge into manualRows
      const pair = [data.user_a.id, data.user_b.id].sort();
      const key = `${pair[0]}::${pair[1]}`;
      const aIsA = data.user_a.id === pair[0];
      const aUser = aIsA ? data.user_a : data.user_b;
      const bUser = aIsA ? data.user_b : data.user_a;
      const aLabel = aUser.age != null ? `${aUser.name}, ${aUser.age}` : aUser.name;
      const bLabel = bUser.age != null ? `${bUser.name}, ${bUser.age}` : bUser.name;
      const newRow: MatchRow = {
        pairKey: key,
        userAId: pair[0],
        userBId: pair[1],
        userAName: aUser.name,
        userBName: bUser.name,
        userAAge: aUser.age ?? null,
        userBAge: bUser.age ?? null,
        userAGender: String(aUser.gender ?? "—"),
        userBGender: String(bUser.gender ?? "—"),
        matchLabel: `${aLabel} × ${bLabel}`,
        score: data.match.score,
        reasons: data.match.reasons,
        reasoning: data.match.reasoning,
        risks: data.match.risks,
        suggested_intro_hook: data.match.suggested_intro_hook,
        dimensions: data.match.dimensions,
        isManual: true,
      };

      setManualRows((prev) => {
        const idx = prev.findIndex((r) => r.pairKey === key);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = newRow;
          return updated;
        }
        return [...prev, newRow];
      });

      // Auto-expand the newly scored row
      setExpandedRows((prev) => new Set([...prev, key]));
    } catch (e) {
      setPairError(e instanceof Error ? e.message : "Scoring failed.");
    } finally {
      setPairLoading(false);
    }
  }

  async function handleAction(row: MatchRow, action: "approve" | "reject") {
    const key = row.pairKey;
    setActionError(null);
    setActionStates((prev) => ({
      ...prev,
      [key]: action === "approve" ? "approving" : "rejecting",
    }));
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setActionStates((prev) => ({ ...prev, [key]: "idle" }));
        return;
      }
      const res = await fetch("/api/admin/matches/action", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          userAId: row.userAId,
          userBId: row.userBId,
          score: row.score,
          reasons: row.reasons,
          reasoning: row.reasoning ?? null,
          risks: row.risks ?? null,
          suggested_intro_hook: row.suggested_intro_hook ?? null,
          dimensions: row.dimensions ?? null,
        }),
      });
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as { status?: string };
        setActionStates((prev) => ({
          ...prev,
          [key]: action === "approve" ? "approved" : "rejected",
        }));
        if (json.status) {
          setMatchStatuses((prev) => ({ ...prev, [key]: json.status! }));
        }
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionStates((prev) => ({ ...prev, [key]: "idle" }));
        setActionError(err.error ?? "Action failed.");
      }
    } catch (e) {
      setActionStates((prev) => ({ ...prev, [key]: "idle" }));
      setActionError(e instanceof Error ? e.message : "Action failed.");
    }
  }

  const rows = useMemo(() => {
    const map = new Map<string, MatchRow>();

    if (result) {
      for (const [, matches] of Object.entries(result.rankings)) {
        for (const match of matches) {
          const pair = [match.user_a_id, match.user_b_id].sort();
          const key = `${pair[0]}::${pair[1]}`;
          const current = map.get(key);
          if (!current || match.score > current.score) {
            const userAMeta = result.users_by_id?.[pair[0]];
            const userBMeta = result.users_by_id?.[pair[1]];
            const aName = userAMeta?.name?.trim() || "—";
            const bName = userBMeta?.name?.trim() || "—";
            const aAge = userAMeta?.age ?? null;
            const bAge = userBMeta?.age ?? null;
            const aLabel = aAge != null ? `${aName}, ${aAge}` : aName;
            const bLabel = bAge != null ? `${bName}, ${bAge}` : bName;
            map.set(key, {
              pairKey: key,
              userAId: pair[0],
              userBId: pair[1],
              userAName: aName,
              userBName: bName,
              userAAge: aAge,
              userBAge: bAge,
              userAGender: String(userAMeta?.gender ?? "—"),
              userBGender: String(userBMeta?.gender ?? "—"),
              matchLabel: `${aLabel} × ${bLabel}`,
              score: match.score,
              reasons: match.reasons,
              reasoning: match.reasoning ?? null,
              risks: match.risks ?? null,
              suggested_intro_hook: match.suggested_intro_hook ?? null,
              dimensions: match.dimensions ?? null,
            });
          }
        }
      }
    }

    // Manual pair rows override dry-run rows for the same pair
    for (const row of manualRows) {
      map.set(row.pairKey, row);
    }

    const sorted = Array.from(map.values()).sort((a, b) => b.score - a.score);
    if (!uniqueOnly) return sorted;

    // Greedy best-unique: pick highest-scoring pair where neither user has appeared yet
    const seen = new Set<string>();
    const unique: MatchRow[] = [];
    for (const row of sorted) {
      if (!seen.has(row.userAId) && !seen.has(row.userBId)) {
        seen.add(row.userAId);
        seen.add(row.userBId);
        unique.push(row);
      }
    }
    return unique;
  }, [result, manualRows, uniqueOnly]);

  async function runPreview() {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("You are not authenticated. Please sign in again.");
        return;
      }
      const res = await fetch("/api/admin/matches/preview", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userLimit: 10, topNPerUser: 3, perUserTopK: 10 }),
      });
      const payload = (await res.json()) as PreviewResponse & { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Failed to run dry-run preview.");
        return;
      }
      setResult(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run dry-run preview.");
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(key: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const hasDetails = (row: MatchRow) =>
    !!(row.reasoning || row.suggested_intro_hook || (row.risks && row.risks.length > 0) || row.dimensions);

  return (
    <div className="flex flex-col gap-6">

      {/* ── Manual pair scorer ── */}
      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Score a Specific Pair</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Select two participants and run matchmaking just for them. Results appear in the table below.
          </p>
        </div>

        <div className="px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Participant A</label>
              <SearchableSelect
                value={selectedA}
                onChange={setSelectedA}
                options={userList.map((u) => ({
                  value: u.id,
                  label: `${u.name}${u.age ? `, ${u.age}` : ""}${u.gender ? ` · ${u.gender}` : ""}`,
                  disabled: u.id === selectedB,
                }))}
              />
            </div>

            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Participant B</label>
              <SearchableSelect
                value={selectedB}
                onChange={setSelectedB}
                options={userList.map((u) => ({
                  value: u.id,
                  label: `${u.name}${u.age ? `, ${u.age}` : ""}${u.gender ? ` · ${u.gender}` : ""}`,
                  disabled: u.id === selectedA,
                }))}
              />
            </div>

            <button
              type="button"
              onClick={() => void scorePair()}
              disabled={pairLoading || !selectedA || !selectedB}
              className="inline-flex items-center justify-center rounded-lg bg-[#0e9f6e] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 sm:self-end"
            >
              {pairLoading ? "Scoring…" : "Matchmake"}
            </button>
          </div>

          {pairError && <p className="mt-3 text-sm text-red-500">{pairError}</p>}
        </div>
      </section>

      {/* ── Matches table ── */}
      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Matchmaking Preview (10 users)
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Dry-run only. No notifications are sent and no matches are persisted until approved.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setUniqueOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                uniqueOnly
                  ? "border-[#0e9f6e] bg-[#0e9f6e]/10 text-[#0e9f6e]"
                  : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${uniqueOnly ? "bg-[#0e9f6e]" : "bg-gray-300 dark:bg-gray-600"}`} />
              Best matches only
            </button>
            <button
              type="button"
              onClick={() => void runPreview()}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-lg bg-[#0e9f6e] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Running…" : "Run Dry-Run (10 users)"}
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
          {actionError && <p className="mb-3 text-sm text-red-500">{actionError}</p>}

          {result && (
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900/40">
              <p className="text-gray-700 dark:text-gray-200">
                Users: <strong>{result.user_count}</strong> · Notifications:{" "}
                <strong>{result.notifications_sent ? "sent" : "disabled"}</strong> · Persisted:{" "}
                <strong>{result.persisted ? "yes" : "no"}</strong>
              </p>
              <p className="mt-1 text-gray-500 dark:text-gray-400">
                Embeddings: {result.model_usage?.embeddings_model ?? "—"} · LLM scoring:{" "}
                {result.model_usage?.llm_scoring ?? "—"}
              </p>
            </div>
          )}

          {!result && !loading && !error && rows.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Run the dry-run preview or score a specific pair above to see matches.
            </p>
          )}

          {result && rows.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No candidate pairs passed filters. Complete more profiles in{" "}
              <Link href="/admin/participants" className="text-[#0e9f6e] hover:underline">
                Participants
              </Link>
              .
            </p>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm text-gray-700 dark:text-white/80">
                <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2">Match</th>
                    <th className="px-3 py-2">User A</th>
                    <th className="px-3 py-2">User B</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Reasons</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {rows.map((row) => {
                    const actionState = actionStates[row.pairKey] ?? "idle";
                    const isActing = actionState === "approving" || actionState === "rejecting";
                    const isExpanded = expandedRows.has(row.pairKey);
                    const canExpand = hasDetails(row);

                    return (
                      <Fragment key={row.pairKey}>
                        <tr className="hover:bg-gray-50/80 dark:hover:bg-white/[0.04]">
                          <td className="px-3 py-2 font-medium text-gray-800 dark:text-white/90 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {canExpand && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(row.pairKey)}
                                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs leading-none select-none"
                                  title="Toggle details"
                                >
                                  {isExpanded ? "▾" : "▸"}
                                </button>
                              )}
                              <span>{row.matchLabel}</span>
                              {row.isManual && (
                                <span className="rounded bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                  manual
                                </span>
                              )}
                              {matchStatuses[row.pairKey] && (
                                <StatusBadge status={matchStatuses[row.pairKey]} />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-sm font-medium text-gray-800 dark:text-white/90">{row.userAName}</div>
                            <div className="font-mono text-xs text-gray-500 dark:text-gray-400">
                              {row.userAId.slice(0, 8)}… · {row.userAGender}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-sm font-medium text-gray-800 dark:text-white/90">{row.userBName}</div>
                            <div className="font-mono text-xs text-gray-500 dark:text-gray-400">
                              {row.userBId.slice(0, 8)}… · {row.userBGender}
                            </div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                row.score >= 0.7
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                  : row.score >= 0.5
                                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400"
                                  : "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                              }`}
                            >
                              {toPercent(row.score)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300 max-w-xs">
                            {row.reasons.join(" · ") || "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => setViewRow(row)}
                                className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20"
                              >
                                View
                              </button>
                              {actionState === "approved" ? (
                                <span className="self-center text-xs font-medium text-green-600 dark:text-green-400">
                                  ✓ Invites sent
                                </span>
                              ) : actionState === "rejected" ? (
                                <span className="self-center text-xs font-medium text-red-500 dark:text-red-400">
                                  ✗ Rejected
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void handleAction(row, "approve")}
                                    disabled={isActing}
                                    className="rounded-md bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40"
                                  >
                                    {actionState === "approving" ? "…" : "Approve"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleAction(row, "reject")}
                                    disabled={isActing}
                                    className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                                  >
                                    {actionState === "rejecting" ? "…" : "Reject"}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>

                        {isExpanded && canExpand && (
                          <tr key={`${row.pairKey}--details`} className="bg-gray-50/60 dark:bg-white/[0.02]">
                            <td colSpan={6} className="px-5 py-4">
                              <div className="flex flex-col gap-3">
                                {/* Dimensions + per-dimension reasoning inline */}
                                {row.dimensions && (
                                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
                                    {Object.entries(row.dimensions).map(([k, v]) =>
                                      v != null ? (
                                        <div key={k}>
                                          <div className="mb-0.5 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                            <span>{dimLabel(k)}</span>
                                            <span>{toPercent(v)}</span>
                                          </div>
                                          <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                                            <div
                                              className="h-1.5 rounded-full bg-[#0e9f6e]"
                                              style={{ width: `${Math.round(v * 100)}%` }}
                                            />
                                          </div>
                                          {row.reasoning?.[k] && (
                                            <p className="mt-1 text-[11px] leading-tight text-gray-500 dark:text-gray-400">
                                              {row.reasoning[k]}
                                            </p>
                                          )}
                                        </div>
                                      ) : null
                                    )}
                                  </div>
                                )}

                                {/* Intro hook */}
                                {row.suggested_intro_hook && (
                                  <p className="rounded-lg border border-[#0e9f6e]/30 bg-[#0e9f6e]/5 px-3 py-2 text-sm italic text-gray-700 dark:text-gray-200">
                                    &ldquo;{row.suggested_intro_hook}&rdquo;
                                  </p>
                                )}

                                {/* Risks */}
                                {row.risks && row.risks.length > 0 && (
                                  <div>
                                    <p className="mb-1 text-xs font-medium uppercase text-red-500">Risks</p>
                                    <ul className="list-disc pl-4 text-xs text-gray-600 dark:text-gray-300">
                                      {row.risks.map((r, i) => (
                                        <li key={i}>{r}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {viewRow && (
        <MatchViewModal
          userAId={viewRow.userAId}
          userBId={viewRow.userBId}
          matchLabel={viewRow.matchLabel}
          onClose={() => setViewRow(null)}
        />
      )}
    </div>
  );
}
