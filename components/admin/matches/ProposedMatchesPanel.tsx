"use client";

import { supabase } from "@/lib/supabase";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MatchViewModal } from "./MatchViewModal";

// ── Types ──────────────────────────────────────────────────────────────────────

type PendingProfile = {
  id: string;
  display_name: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  phone_e164: string | null;
};

type PendingMatch = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  compatibility_score: number | null;
  reasons: string[] | null;
  reasoning: Record<string, string> | null;
  risks: string[] | null;
  suggested_intro_hook: string | null;
  score_breakdown: Record<string, number> | null;
  created_at: string | null;
  user_a: PendingProfile | null;
  user_b: PendingProfile | null;
};

type ActiveMatch = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  status: string;
  user_a_response: string | null;
  user_b_response: string | null;
  user_a_responded_at: string | null;
  user_b_responded_at: string | null;
  updated_at: string | null;
  compatibility_score: number | null;
  suggested_intro_hook: string | null;
  last_inbound_at: string | null;
  admin_read_at: string | null;
  user_a_auto_reply_enabled: boolean;
  user_b_auto_reply_enabled: boolean;
  user_a: PendingProfile | null;
  user_b: PendingProfile | null;
};

type TabCounts = { pending: number; active: number; mutual_yes: number };

type UserListItem = {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
};

type ManualRow = {
  pairKey: string;
  userAId: string;
  userBId: string;
  userAName: string;
  userBName: string;
  userAAge: number | null;
  userBAge: number | null;
  userAGender: string;
  userBGender: string;
  score: number;
  reasons: string[];
  reasoning: Record<string, string> | null;
  risks: string[] | null;
  suggested_intro_hook: string | null;
  dimensions: Record<string, number> | null;
};

type PageMeta = {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
};

type RunResult = {
  inserted: number;
  skipped: number;
  total_users: number;
  total_pairs: number;
};

type RunProgressLine = {
  stage: string;
  message?: string;
  progress?: number;
  inserted?: number;
  skipped?: number;
  total_users?: number;
  total_pairs?: number;
};

type ActionState = "idle" | "approving" | "rejecting" | "approved" | "rejected";

type ViewItem = { userAId: string; userBId: string; matchLabel: string };

// ── SmsDraftBox ────────────────────────────────────────────────────────────────

function SmsDraftBox({
  label,
  phone,
  getToken,
  matchId,
  slot,
  autoReplyEnabled,
  onAutoReplyToggled,
}: {
  label: string;
  phone: string | null | undefined;
  getToken: () => Promise<string | null>;
  matchId: string;
  slot: "a" | "b";
  autoReplyEnabled: boolean;
  onAutoReplyToggled: (enabled: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [togglingAI, setTogglingAI] = useState(false);

  async function send() {
    const msg = draft.trim();
    if (!msg || !phone) return;
    setSending(true);
    setErr(null);
    setSent(false);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const res = await fetch("/api/admin/sms/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, message: msg, provider: "linq" }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed to send");
      }
      setDraft("");
      setSent(true);
      setTimeout(() => setSent(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  async function toggleAI() {
    setTogglingAI(true);
    try {
      const token = await getToken();
      if (!token) return;
      const next = !autoReplyEnabled;
      const res = await fetch("/api/admin/matches/auto-reply", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, slot, enabled: next }),
      });
      if (res.ok) onAutoReplyToggled(next);
    } finally {
      setTogglingAI(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</p>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void toggleAI()}
          disabled={togglingAI}
          title={autoReplyEnabled ? "AI auto-reply is ON — click to disable" : "AI auto-reply is OFF — click to enable"}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition ${
            autoReplyEnabled
              ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"
              : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400"
          } disabled:opacity-50`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${autoReplyEnabled ? "bg-green-500" : "bg-gray-400"}`} />
          Auto reply {autoReplyEnabled ? "ON" : "OFF"}
        </button>
      </div>
      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          rows={2}
          placeholder={phone ? `Message as Inyo…` : "No phone on file"}
          disabled={sending || !phone}
          className="flex-1 resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0e9f6e] focus:outline-none disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900/40 dark:text-white/90"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim() || !phone}
          className="self-end rounded-lg bg-[#0e9f6e] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {sent ? "✓" : sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function dimLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function profileLabel(p: PendingProfile | null): string {
  if (!p) return "—";
  const parts = [p.display_name ?? "Unknown"];
  if (p.age) parts.push(String(p.age));
  return parts.join(", ");
}

// ── SearchableSelect ───────────────────────────────────────────────────────────

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

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

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

// ── Response pill ──────────────────────────────────────────────────────────────

function ResponsePill({ value }: { value: string | null }) {
  if (value === "interested") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
        ✓ yes
      </span>
    );
  }
  if (value === "declined") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/40 dark:text-red-400">
        ✗ no
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">
      …
    </span>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────────

export default function ProposedMatchesPanel() {
  // DB pending matches
  const [matches, setMatches] = useState<PendingMatch[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>({ total: 0, page: 1, per_page: 20, total_pages: 1 });
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<"pending" | "active">("pending");
  const [activeMatches, setActiveMatches] = useState<ActiveMatch[]>([]);
  const [loadingActive, setLoadingActive] = useState(false);
  const [tabCounts, setTabCounts] = useState<TabCounts>({ pending: 0, active: 0, mutual_yes: 0 });
  const [gcLoading, setGcLoading] = useState<Record<string, boolean>>({});
  const [gcError, setGcError] = useState<string | null>(null);
  const [expandedActiveRows, setExpandedActiveRows] = useState<Set<string>>(new Set());

  // Manual pair scorer
  const [userList, setUserList] = useState<UserListItem[]>([]);
  const [selectedA, setSelectedA] = useState("");
  const [selectedB, setSelectedB] = useState("");
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [manualRows, setManualRows] = useState<ManualRow[]>([]);

  // Run matchmaking
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runProgress, setRunProgress] = useState<number>(0);
  const [runLog, setRunLog] = useState<Array<{ time: string; message: string; stage: string }>>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Actions (shared key space: DB rows use match.id, manual rows use pairKey)
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const [viewItem, setViewItem] = useState<ViewItem | null>(null);

  async function getToken(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  // Load tab counts
  const loadCounts = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/admin/proposed-matches?tab=counts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as TabCounts;
      setTabCounts(json);
    } catch {
      // non-critical — ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load paginated pending matches from DB
  const loadPage = useCallback(async (page: number) => {
    setLoadingList(true);
    setListError(null);
    try {
      const token = await getToken();
      if (!token) { setListError("Not authenticated."); return; }
      const res = await fetch(`/api/admin/proposed-matches?tab=pending&page=${page}&per_page=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as {
        data?: PendingMatch[];
        total?: number;
        page?: number;
        per_page?: number;
        total_pages?: number;
        error?: string;
      };
      if (!res.ok) { setListError(json.error ?? "Failed to load matches."); return; }
      setMatches(json.data ?? []);
      setPageMeta({
        total: json.total ?? 0,
        page: json.page ?? page,
        per_page: json.per_page ?? 20,
        total_pages: json.total_pages ?? 1,
      });
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load matches.");
    } finally {
      setLoadingList(false);
      void loadCounts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCounts]);

  // Load active (in-flight) matches
  const loadActivePage = useCallback(async () => {
    setLoadingActive(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/admin/proposed-matches?tab=active&per_page=50", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: ActiveMatch[] };
      setActiveMatches(json.data ?? []);
    } catch {
      // non-critical
    } finally {
      setLoadingActive(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isUnread(m: { last_inbound_at: string | null; admin_read_at: string | null }): boolean {
    if (!m.last_inbound_at) return false;
    if (!m.admin_read_at) return true;
    return new Date(m.last_inbound_at) > new Date(m.admin_read_at);
  }

  const unreadCount = activeMatches.filter(isUnread).length;

  async function markRead(matchId: string) {
    const token = await getToken();
    if (!token) return;
    await fetch("/api/admin/matches/mark-read", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ matchId }),
    });
    setActiveMatches((prev) =>
      prev.map((m) => m.id === matchId ? { ...m, admin_read_at: new Date().toISOString() } : m),
    );
  }

  // Manually create a group chat for a mutual_yes match
  async function createGroupChat(matchId: string) {
    setGcError(null);
    setGcLoading((prev) => ({ ...prev, [matchId]: true }));
    try {
      const token = await getToken();
      if (!token) { setGcError("Not authenticated."); return; }
      const res = await fetch("/api/admin/matches/create-gc", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      if (res.ok) {
        setActiveMatches((prev) => prev.filter((m) => m.id !== matchId));
        void loadCounts();
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setGcError(err.error ?? "Group chat creation failed.");
      }
    } catch (e) {
      setGcError(e instanceof Error ? e.message : "Group chat creation failed.");
    } finally {
      setGcLoading((prev) => { const next = { ...prev }; delete next[matchId]; return next; });
    }
  }

  // Load participant list for the pair scorer dropdowns
  const loadUserList = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const res = await fetch("/api/admin/matches/preview", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { users?: UserListItem[] };
    setUserList(data.users ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadPage(1);
    void loadUserList();
    void loadActivePage();
    void loadCounts();
  }, [loadPage, loadUserList, loadActivePage, loadCounts]);


  // Score a specific pair manually
  async function scorePair() {
    if (!selectedA || !selectedB) return;
    setPairLoading(true);
    setPairError(null);
    try {
      const token = await getToken();
      if (!token) { setPairError("Not authenticated."); return; }
      const res = await fetch("/api/admin/matches/preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userAId: selectedA, userBId: selectedB }),
      });
      const data = (await res.json()) as {
        pair_mode?: boolean;
        user_a?: UserListItem;
        user_b?: UserListItem;
        match?: {
          score: number;
          reasons: string[];
          reasoning?: Record<string, string> | null;
          risks?: string[] | null;
          suggested_intro_hook?: string | null;
          dimensions?: Record<string, number> | null;
        };
        error?: string;
      };
      if (!res.ok || !data.user_a || !data.user_b || !data.match) {
        setPairError(data.error ?? "Scoring failed.");
        return;
      }

      const pair = [data.user_a.id, data.user_b.id].sort();
      const key = `${pair[0]}::${pair[1]}`;
      const aIsA = data.user_a.id === pair[0];
      const aUser = aIsA ? data.user_a : data.user_b;
      const bUser = aIsA ? data.user_b : data.user_a;

      const newRow: ManualRow = {
        pairKey: key,
        userAId: pair[0],
        userBId: pair[1],
        userAName: aUser.name,
        userBName: bUser.name,
        userAAge: aUser.age ?? null,
        userBAge: bUser.age ?? null,
        userAGender: String(aUser.gender ?? "—"),
        userBGender: String(bUser.gender ?? "—"),
        score: data.match.score,
        reasons: data.match.reasons,
        reasoning: data.match.reasoning ?? null,
        risks: data.match.risks ?? null,
        suggested_intro_hook: data.match.suggested_intro_hook ?? null,
        dimensions: data.match.dimensions ?? null,
      };

      setManualRows((prev) => {
        const idx = prev.findIndex((r) => r.pairKey === key);
        if (idx >= 0) { const updated = [...prev]; updated[idx] = newRow; return updated; }
        return [newRow, ...prev];
      });
      setExpandedRows((prev) => new Set([...prev, key]));
    } catch (e) {
      setPairError(e instanceof Error ? e.message : "Scoring failed.");
    } finally {
      setPairLoading(false);
    }
  }

  // Auto-scroll log to bottom when new lines arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runLog]);

  function appendLog(message: string, stage: string) {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setRunLog((prev) => [...prev, { time, message, stage }]);
  }

  // Run full matchmaking on all users and save pending_review rows
  async function runMatchmaking(reset = false) {
    if (reset && !confirm("This will delete all pending_review proposals and re-score from scratch. Continue?")) return;
    setRunning(true);
    setRunResult(null);
    setRunProgress(0);
    setRunLog([]);
    appendLog(reset ? "Reset & Re-run started…" : "Run started…", "start");
    try {
      const token = await getToken();
      if (!token) {
        appendLog("Not authenticated.", "error");
        setRunning(false);
        return;
      }
      const res = await fetch("/api/admin/matches/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(reset ? { reset: true } : {}),
      });
      if (!res.body) {
        appendLog("No response stream from server.", "error");
        setRunning(false);
        return;
      }

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
            const data = JSON.parse(line) as RunProgressLine;
            appendLog(data.message ?? data.stage, data.stage);
            if (data.progress != null) setRunProgress(data.progress);
            if (data.stage === "done") {
              setRunResult({
                inserted: data.inserted ?? 0,
                skipped: data.skipped ?? 0,
                total_users: data.total_users ?? 0,
                total_pairs: data.total_pairs ?? 0,
              });
              await loadPage(1);
            }
          } catch {
            // malformed line — skip
          }
        }
      }
    } catch (e) {
      appendLog(e instanceof Error ? e.message : "Matchmaking run failed.", "error");
    } finally {
      setRunning(false);
    }
  }

  // Shared action handler — key is match.id for DB rows, pairKey for manual rows
  async function handleAction(
    key: string,
    payload: {
      userAId: string;
      userBId: string;
      score: number;
      reasons: string[];
      reasoning: Record<string, string> | null;
      risks: string[] | null;
      suggested_intro_hook: string | null;
      dimensions: Record<string, number> | null;
    },
    action: "approve" | "reject",
    onSuccess: () => void,
  ) {
    setActionError(null);
    setActionStates((prev) => ({ ...prev, [key]: action === "approve" ? "approving" : "rejecting" }));
    try {
      const token = await getToken();
      if (!token) { setActionStates((prev) => ({ ...prev, [key]: "idle" })); return; }
      const res = await fetch("/api/admin/matches/action", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (res.ok) {
        setActionStates((prev) => ({ ...prev, [key]: action === "approve" ? "approved" : "rejected" }));
        setTimeout(() => {
          onSuccess();
          setActionStates((prev) => { const next = { ...prev }; delete next[key]; return next; });
        }, 800);
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

  async function deleteMatch(matchId: string, onSuccess: () => void) {
    if (!confirm("Delete this match permanently? This cannot be undone.")) return;
    const token = await getToken();
    if (!token) return;
    const res = await fetch("/api/admin/matches/action", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", matchId }),
    });
    if (res.ok) {
      onSuccess();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setActionError(err.error ?? "Delete failed.");
    }
  }

  function toggleExpand(key: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ── Shared row renderer ────────────────────────────────────────────────────

  function renderRow(opts: {
    key: string;
    userAId: string;
    userBId: string;
    matchLabel: string;
    nameA: string;
    metaA: string;
    nameB: string;
    metaB: string;
    score: number | null;
    reasons: string[] | null;
    reasoning: Record<string, string> | null;
    risks: string[] | null;
    suggested_intro_hook: string | null;
    dimensions: Record<string, number> | null;
    badge?: React.ReactNode;
  }) {
    const actionState = actionStates[opts.key] ?? "idle";
    const isActing = actionState === "approving" || actionState === "rejecting";
    const isDone = actionState === "approved" || actionState === "rejected";
    const isExpanded = expandedRows.has(opts.key);
    const hasDetails = !!(opts.reasoning || opts.suggested_intro_hook || (opts.risks && opts.risks.length > 0) || opts.dimensions);
    const score = opts.score ?? 0;

    return (
      <Fragment key={opts.key}>
        <tr className="hover:bg-gray-50/80 dark:hover:bg-white/[0.04]">
          <td className="px-3 py-2 font-medium text-gray-800 dark:text-white/90 whitespace-nowrap">
            <div className="flex items-center gap-1.5">
              {hasDetails && (
                <button
                  type="button"
                  onClick={() => toggleExpand(opts.key)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs leading-none select-none"
                  title="Toggle details"
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
              )}
              <span>{opts.matchLabel}</span>
              {opts.badge}
            </div>
          </td>

          <td className="px-3 py-2">
            <div className="text-sm font-medium text-gray-800 dark:text-white/90">{opts.nameA}</div>
            <div className="font-mono text-xs text-gray-500 dark:text-gray-400">{opts.metaA}</div>
          </td>

          <td className="px-3 py-2">
            <div className="text-sm font-medium text-gray-800 dark:text-white/90">{opts.nameB}</div>
            <div className="font-mono text-xs text-gray-500 dark:text-gray-400">{opts.metaB}</div>
          </td>

          <td className="px-3 py-2 whitespace-nowrap">
            {opts.score != null ? (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  score >= 0.7
                    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                    : score >= 0.5
                    ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400"
                    : "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                }`}
              >
                {toPercent(score)}
              </span>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </td>

          <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300 max-w-xs">
            {opts.reasons?.join(" · ") || "—"}
          </td>

          <td className="px-3 py-2 whitespace-nowrap">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setViewItem({ userAId: opts.userAId, userBId: opts.userBId, matchLabel: opts.matchLabel })}
                className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20"
              >
                View
              </button>
              {isDone ? (
                <span className={`self-center text-xs font-medium ${actionState === "approved" ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                  {actionState === "approved" ? "✓ Invites sent" : "✗ Rejected"}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void handleAction(
                      opts.key,
                      { userAId: opts.userAId, userBId: opts.userBId, score: opts.score ?? 0, reasons: opts.reasons ?? [], reasoning: opts.reasoning, risks: opts.risks, suggested_intro_hook: opts.suggested_intro_hook, dimensions: opts.dimensions },
                      "approve",
                      opts.badge
                        ? () => setManualRows((prev) => prev.filter((r) => r.pairKey !== opts.key))
                        : () => { setMatches((prev) => prev.filter((m) => m.id !== opts.key)); setPageMeta((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) })); },
                    )}
                    disabled={isActing}
                    className="rounded-md bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40"
                  >
                    {actionState === "approving" ? "…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAction(
                      opts.key,
                      { userAId: opts.userAId, userBId: opts.userBId, score: opts.score ?? 0, reasons: opts.reasons ?? [], reasoning: opts.reasoning, risks: opts.risks, suggested_intro_hook: opts.suggested_intro_hook, dimensions: opts.dimensions },
                      "reject",
                      opts.badge
                        ? () => setManualRows((prev) => prev.filter((r) => r.pairKey !== opts.key))
                        : () => { setMatches((prev) => prev.filter((m) => m.id !== opts.key)); setPageMeta((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) })); },
                    )}
                    disabled={isActing}
                    className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                  >
                    {actionState === "rejecting" ? "…" : "Reject"}
                  </button>
                  {!opts.badge && (
                    <button
                      type="button"
                      onClick={() => void deleteMatch(
                        opts.key,
                        () => { setMatches((prev) => prev.filter((m) => m.id !== opts.key)); setPageMeta((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) })); },
                      )}
                      disabled={isActing}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-red-400"
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>
          </td>
        </tr>

        {isExpanded && hasDetails && (
          <tr key={`${opts.key}--details`} className="bg-gray-50/60 dark:bg-white/[0.02]">
            <td colSpan={6} className="px-5 py-4">
              <div className="flex flex-col gap-3">
                {opts.dimensions && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
                    {Object.entries(opts.dimensions).map(([k, v]) =>
                      v != null ? (
                        <div key={k}>
                          <div className="mb-0.5 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                            <span>{dimLabel(k)}</span>
                            <span>{toPercent(v)}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                            <div className="h-1.5 rounded-full bg-[#0e9f6e]" style={{ width: `${Math.round(v * 100)}%` }} />
                          </div>
                          {opts.reasoning?.[k] && (
                            <p className="mt-1 text-[11px] leading-tight text-gray-500 dark:text-gray-400">
                              {opts.reasoning[k]}
                            </p>
                          )}
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
                {opts.suggested_intro_hook && (
                  <p className="rounded-lg border border-[#0e9f6e]/30 bg-[#0e9f6e]/5 px-3 py-2 text-sm italic text-gray-700 dark:text-gray-200">
                    &ldquo;{opts.suggested_intro_hook}&rdquo;
                  </p>
                )}
                {opts.risks && opts.risks.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase text-red-500">Risks</p>
                    <ul className="list-disc pl-4 text-xs text-gray-600 dark:text-gray-300">
                      {opts.risks.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  // ── JSX ───────────────────────────────────────────────────────────────────────

  const hasRows = manualRows.length > 0 || matches.length > 0;

  return (
    <div className="flex flex-col gap-6">

      {/* ── Manual pair scorer ── */}
      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Score a Specific Pair</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Select two participants and score their compatibility. Result appears in the table below.
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

      {/* ── Matches table (tabbed) ── */}
      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Proposed Matches</h2>
            {/* Tab switcher */}
            <div className="mt-2 flex gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("pending")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition ${
                  activeTab === "pending"
                    ? "bg-[#0e9f6e] text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20"
                }`}
              >
                Pending Review
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${activeTab === "pending" ? "bg-white/20 text-white" : "bg-gray-200 text-gray-600 dark:bg-white/20 dark:text-gray-300"}`}>
                  {tabCounts.pending}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("active")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition ${
                  activeTab === "active"
                    ? "bg-[#0e9f6e] text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20"
                }`}
              >
                Active Invites
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${activeTab === "active" ? "bg-white/20 text-white" : "bg-gray-200 text-gray-600 dark:bg-white/20 dark:text-gray-300"}`}>
                  {tabCounts.active}
                </span>
                {unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white" title={`${unreadCount} unread`}>
                    {unreadCount}
                  </span>
                )}
                {tabCounts.mutual_yes > 0 && (
                  <span className="inline-block h-2 w-2 rounded-full bg-green-400" title={`${tabCounts.mutual_yes} mutual yes`} />
                )}
              </button>
            </div>
          </div>
          {activeTab === "pending" && (
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void runMatchmaking(false)}
                  disabled={running}
                  className="inline-flex items-center justify-center rounded-lg bg-[#0e9f6e] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {running ? (
                    <>
                      <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Running…
                    </>
                  ) : (
                    "Run Matchmaking"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void runMatchmaking(true)}
                  disabled={running}
                  className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                >
                  Reset & Re-run
                </button>
              </div>
              {runProgress > 0 && runProgress < 100 && (
                <div className="w-56">
                  <div className="mb-1 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{runProgress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className="h-1.5 rounded-full bg-[#0e9f6e] transition-all duration-500"
                      style={{ width: `${runProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-4">
          {/* ── Pending tab content ── */}
          {activeTab === "pending" && (
            <>
              {runLog.length > 0 && (
                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-950 dark:border-gray-700">
                  <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
                    <span className="text-xs font-medium text-gray-400">Run log</span>
                    {!running && (
                      <button
                        type="button"
                        onClick={() => { setRunLog([]); setRunProgress(0); setRunResult(null); }}
                        className="text-xs text-gray-500 hover:text-gray-300"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="max-h-56 overflow-y-auto px-3 py-2 font-mono text-xs">
                    {runLog.map((entry, i) => (
                      <div key={i} className="flex gap-2 leading-5">
                        <span className="shrink-0 text-gray-600">{entry.time}</span>
                        <span
                          className={
                            entry.stage === "error"
                              ? "text-red-400"
                              : entry.stage === "done"
                              ? "text-green-400"
                              : entry.stage === "scoring"
                              ? "text-amber-300"
                              : entry.stage === "reset"
                              ? "text-orange-400"
                              : "text-gray-300"
                          }
                        >
                          {entry.message}
                        </span>
                      </div>
                    ))}
                    {running && (
                      <div className="mt-1 flex items-center gap-1.5 text-gray-500">
                        <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-[#0e9f6e]" />
                        <span>working…</span>
                      </div>
                    )}
                    <div ref={logEndRef} />
                  </div>
                  {runResult && (
                    <div className="border-t border-gray-800 px-3 py-2 text-xs text-green-400">
                      {runResult.inserted} new matches saved · {runResult.total_pairs} pairs evaluated · {runResult.total_users} users
                      {runResult.skipped > 0 ? ` · ${runResult.skipped} already existed` : ""}
                    </div>
                  )}
                </div>
              )}

              {listError && <p className="mb-3 text-sm text-red-500">{listError}</p>}
              {actionError && <p className="mb-3 text-sm text-red-500">{actionError}</p>}

              {loadingList && <p className="py-8 text-center text-sm text-gray-400">Loading matches…</p>}

              {!loadingList && !hasRows && (
                <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                  No pending matches. Score a pair above or click &ldquo;Run Matchmaking&rdquo; to generate proposals.
                </p>
              )}

              {!loadingList && hasRows && (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm text-gray-700 dark:text-white/80">
                      <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
                        <tr>
                          <th className="px-3 py-2">Match</th>
                          <th className="px-3 py-2">User A</th>
                          <th className="px-3 py-2">User B</th>
                          <th className="px-3 py-2">Score</th>
                          <th className="px-3 py-2 max-w-xs">Reasons</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {/* Manual rows first with "manual" badge */}
                        {manualRows.map((r) => {
                          const aLabel = r.userAAge != null ? `${r.userAName}, ${r.userAAge}` : r.userAName;
                          const bLabel = r.userBAge != null ? `${r.userBName}, ${r.userBAge}` : r.userBName;
                          return renderRow({
                            key: r.pairKey,
                            userAId: r.userAId,
                            userBId: r.userBId,
                            matchLabel: `${aLabel} × ${bLabel}`,
                            nameA: r.userAName,
                            metaA: `${r.userAId.slice(0, 8)}… · ${r.userAGender}`,
                            nameB: r.userBName,
                            metaB: `${r.userBId.slice(0, 8)}… · ${r.userBGender}`,
                            score: r.score,
                            reasons: r.reasons,
                            reasoning: r.reasoning,
                            risks: r.risks,
                            suggested_intro_hook: r.suggested_intro_hook,
                            dimensions: r.dimensions,
                            badge: (
                              <span className="rounded bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                manual
                              </span>
                            ),
                          });
                        })}

                        {/* DB pending rows */}
                        {matches.map((m) => {
                          const aLabel = profileLabel(m.user_a);
                          const bLabel = profileLabel(m.user_b);
                          return renderRow({
                            key: m.id,
                            userAId: m.user_a_id,
                            userBId: m.user_b_id,
                            matchLabel: `${aLabel} × ${bLabel}`,
                            nameA: m.user_a?.display_name ?? "—",
                            metaA: `${m.user_a_id.slice(0, 8)}… · ${m.user_a?.gender ?? "—"}${m.user_a?.city ? ` · ${m.user_a.city}` : ""}`,
                            nameB: m.user_b?.display_name ?? "—",
                            metaB: `${m.user_b_id.slice(0, 8)}… · ${m.user_b?.gender ?? "—"}${m.user_b?.city ? ` · ${m.user_b.city}` : ""}`,
                            score: m.compatibility_score,
                            reasons: m.reasons,
                            reasoning: m.reasoning,
                            risks: m.risks,
                            suggested_intro_hook: m.suggested_intro_hook,
                            dimensions: m.score_breakdown,
                          });
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {pageMeta.total_pages > 1 && (
                    <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Page {pageMeta.page} of {pageMeta.total_pages} &middot; {pageMeta.total} total
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void loadPage(pageMeta.page - 1)}
                          disabled={pageMeta.page <= 1 || loadingList}
                          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() => void loadPage(pageMeta.page + 1)}
                          disabled={pageMeta.page >= pageMeta.total_pages || loadingList}
                          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── Active Invites tab content ── */}
          {activeTab === "active" && (
            <>
              {gcError && <p className="mb-3 text-sm text-red-500">{gcError}</p>}

              {loadingActive && <p className="py-8 text-center text-sm text-gray-400">Loading active invites…</p>}

              {!loadingActive && activeMatches.length === 0 && (
                <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                  No active invites right now.
                </p>
              )}

              {!loadingActive && activeMatches.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-gray-700 dark:text-white/80">
                    <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
                      <tr>
                        <th className="px-3 py-2">Match</th>
                        <th className="px-3 py-2">User A</th>
                        <th className="px-3 py-2">User B</th>
                        <th className="px-3 py-2">Responses</th>
                        <th className="px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {activeMatches.map((m) => {
                        const aLabel = profileLabel(m.user_a);
                        const bLabel = profileLabel(m.user_b);
                        const matchLabel = `${aLabel} × ${bLabel}`;
                        const isMutualYes = m.status === "mutual_yes";
                        const isGcLoading = gcLoading[m.id] ?? false;
                        const declineState = actionStates[m.id] ?? "idle";
                        const isDeclineActing = declineState === "rejecting";
                        const isDeclineDone = declineState === "rejected";
                        const isActiveExpanded = expandedActiveRows.has(m.id);
                        const rowUnread = isUnread(m);

                        return (
                          <Fragment key={m.id}>
                          <tr className="hover:bg-gray-50/80 dark:hover:bg-white/[0.04]">
                            <td className="px-3 py-2 font-medium text-gray-800 dark:text-white/90 whitespace-nowrap">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedActiveRows((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                                        return next;
                                      });
                                      if (rowUnread) void markRead(m.id);
                                    }}
                                    className="select-none text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                  >
                                    {isActiveExpanded ? "▾" : "▸"}
                                  </button>
                                  <span>{matchLabel}</span>
                                  {rowUnread && (
                                    <span className="inline-block h-2 w-2 rounded-full bg-red-500" title="New message" />
                                  )}
                                </div>
                                {isMutualYes ? (
                                  <span className="text-xs font-bold text-green-600 dark:text-green-400">Both YES 🎉</span>
                                ) : m.status === "awaiting_one_response" ? (
                                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">1 / 2 yes</span>
                                ) : m.status === "declined_awaiting_feedback" ? (
                                  <span className="text-xs font-medium text-red-500 dark:text-red-400">someone said no</span>
                                ) : (
                                  <span className="text-xs text-gray-400">waiting</span>
                                )}
                              </div>
                            </td>

                            <td className="px-3 py-2">
                              <div className="text-sm font-medium text-gray-800 dark:text-white/90">{m.user_a?.display_name ?? "—"}</div>
                              <div className="font-mono text-xs text-gray-500 dark:text-gray-400">
                                {m.user_a_id.slice(0, 8)}… · {m.user_a?.gender ?? "—"}{m.user_a?.city ? ` · ${m.user_a.city}` : ""}
                              </div>
                            </td>

                            <td className="px-3 py-2">
                              <div className="text-sm font-medium text-gray-800 dark:text-white/90">{m.user_b?.display_name ?? "—"}</div>
                              <div className="font-mono text-xs text-gray-500 dark:text-gray-400">
                                {m.user_b_id.slice(0, 8)}… · {m.user_b?.gender ?? "—"}{m.user_b?.city ? ` · ${m.user_b.city}` : ""}
                              </div>
                            </td>

                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <ResponsePill value={m.user_a_response} />
                                <ResponsePill value={m.user_b_response} />
                              </div>
                            </td>

                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="flex flex-wrap gap-1.5">
                                {isDeclineDone ? (
                                  <span className="self-center text-xs font-medium text-red-500 dark:text-red-400">✗ Declined</span>
                                ) : (
                                  <>
                                    {isMutualYes && (
                                      <button
                                        type="button"
                                        onClick={() => void createGroupChat(m.id)}
                                        disabled={isGcLoading}
                                        className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                                      >
                                        {isGcLoading ? "Creating…" : "Create Group Chat"}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => void handleAction(
                                        m.id,
                                        {
                                          userAId: m.user_a_id,
                                          userBId: m.user_b_id,
                                          score: m.compatibility_score ?? 0,
                                          reasons: [],
                                          reasoning: null,
                                          risks: null,
                                          suggested_intro_hook: m.suggested_intro_hook,
                                          dimensions: null,
                                        },
                                        "reject",
                                        () => setActiveMatches((prev) => prev.filter((am) => am.id !== m.id)),
                                      )}
                                      disabled={isDeclineActing || isGcLoading}
                                      className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                                    >
                                      {isDeclineActing ? "…" : "Decline"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void deleteMatch(
                                        m.id,
                                        () => setActiveMatches((prev) => prev.filter((am) => am.id !== m.id)),
                                      )}
                                      disabled={isDeclineActing || isGcLoading}
                                      className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-red-400"
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isActiveExpanded && (
                            <tr key={`${m.id}--compose`} className="bg-gray-50/60 dark:bg-white/[0.02]">
                              <td colSpan={5} className="px-5 py-4">
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                  <SmsDraftBox
                                    label={`${m.user_a?.display_name ?? "User A"} — DM`}
                                    phone={m.user_a?.phone_e164}
                                    getToken={getToken}
                                    matchId={m.id}
                                    slot="a"
                                    autoReplyEnabled={m.user_a_auto_reply_enabled}
                                    onAutoReplyToggled={(enabled) =>
                                      setActiveMatches((prev) =>
                                        prev.map((x) => x.id === m.id ? { ...x, user_a_auto_reply_enabled: enabled } : x)
                                      )
                                    }
                                  />
                                  <SmsDraftBox
                                    label={`${m.user_b?.display_name ?? "User B"} — DM`}
                                    phone={m.user_b?.phone_e164}
                                    getToken={getToken}
                                    matchId={m.id}
                                    slot="b"
                                    autoReplyEnabled={m.user_b_auto_reply_enabled}
                                    onAutoReplyToggled={(enabled) =>
                                      setActiveMatches((prev) =>
                                        prev.map((x) => x.id === m.id ? { ...x, user_b_auto_reply_enabled: enabled } : x)
                                      )
                                    }
                                  />
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
            </>
          )}
        </div>
      </section>

      {viewItem && (
        <MatchViewModal
          userAId={viewItem.userAId}
          userBId={viewItem.userBId}
          matchLabel={viewItem.matchLabel}
          onClose={() => setViewItem(null)}
        />
      )}
    </div>
  );
}
