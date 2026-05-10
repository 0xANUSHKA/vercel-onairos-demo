"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import {
  defaultResponseType,
  isFileLikeResponseType,
  parseFileAnswerJson,
  type FileResponseType,
} from "@/lib/question-response";
import MediaFilePreview from "@/components/admin/participants/MediaFilePreview";

// ── Types ─────────────────────────────────────────────────────────────────────

type IntroProfile = {
  id: string;
  display_name: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  phone_e164: string | null;
};

type IntroducedMatch = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  linq_chat_id: string | null;
  gc_created_at: string | null;
  last_inbound_at: string | null;
  admin_read_at: string | null;
  user_a_auto_reply_enabled: boolean;
  user_b_auto_reply_enabled: boolean;
  user_a: IntroProfile | null;
  user_b: IntroProfile | null;
};

// ── Profile + SMS types (mirrored from MatchViewModal) ────────────────────────

type Profile = {
  id: string;
  phone_e164: string;
  display_name: string | null;
  age: number | null;
  gender: string | null;
  height: string | null;
  intro_reply_raw: string | null;
};

type SmsMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
};

type MediaItem = {
  id: string;
  question: string;
  kind: FileResponseType;
  url: string;
};

type AnswerRow = { question_id: string; response_text: string | null };
type QuestionRow = { id: string; question: string; response_type?: string | null };

// ── Linq group chat types ─────────────────────────────────────────────────────

type LinqMessagePart = {
  type: string;
  value?: string;
  url?: string;
};

type LinqSenderHandle = {
  phone_number?: string;
  number?: string;
  handle?: string;
  is_me?: boolean;
};

type LinqMessage = {
  id: string;
  parts?: LinqMessagePart[];
  sender_handle?: LinqSenderHandle;
  from?: string | LinqSenderHandle;
  created_at?: string;
  occurred_at?: string;
  timestamp?: string;
  [key: string]: unknown;
};

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\D/g, "").slice(-10);
}

function extractSenderPhone(msg: LinqMessage): string {
  const sh = msg.sender_handle;
  const candidates = [
    sh?.phone_number,
    sh?.number,
    sh?.handle,
    typeof msg.from === "string" ? msg.from : undefined,
    typeof msg.from === "object" && msg.from !== null
      ? ((msg.from as LinqSenderHandle).phone_number ?? (msg.from as LinqSenderHandle).number ?? (msg.from as LinqSenderHandle).handle)
      : undefined,
  ];
  for (const c of candidates) {
    if (c && String(c).trim()) return String(c).trim();
  }
  return "";
}

function extractMessageTimestamp(msg: LinqMessage): string {
  return String(msg.created_at ?? msg.occurred_at ?? msg.timestamp ?? "");
}

function messageTimestampMs(msg: LinqMessage): number {
  const raw = msg.created_at ?? msg.occurred_at ?? msg.timestamp;
  if (raw == null) return 0;
  // Try ISO string parse first
  const iso = new Date(String(raw)).getTime();
  if (Number.isFinite(iso)) return iso;
  // Try as a raw number (Unix seconds or milliseconds)
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  // If < 1e12 it's Unix seconds, otherwise milliseconds
  return n < 1e12 ? n * 1000 : n;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function fmtDateShort(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function profileLabel(p: IntroProfile | null): string {
  if (!p) return "Unknown";
  return p.display_name ?? "—";
}

// ── useUserPaneData (same logic as MatchViewModal) ────────────────────────────

type PaneData = {
  profile: Profile | null;
  media: MediaItem[];
  messages: SmsMessage[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

function useUserPaneData(profileId: string): PaneData {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        if (!accessToken) { setError("Not authenticated."); setLoading(false); return; }
        const h = { Authorization: `Bearer ${accessToken}` };

        const profRes = await fetch(`/api/admin/profiles/${profileId}`, { headers: h, cache: "no-store" });
        const profJson = (await profRes.json()) as { data?: Profile; error?: string };
        if (!profRes.ok) throw new Error(profJson.error ?? "Failed to load profile");
        const prof = profJson.data!;
        setProfile(prof);

        const [answersRes, questionsRes, convRes] = await Promise.all([
          fetch(`/api/admin/profiles/${profileId}/answers`, { headers: h, cache: "no-store" }),
          fetch(`/api/admin/questions`, { headers: h, cache: "no-store" }),
          fetch(`/api/admin/sms/conversations/by-phone?phone=${encodeURIComponent(prof.phone_e164)}`, {
            headers: h,
            cache: "no-store",
          }),
        ]);

        const answersJson = (await answersRes.json()) as { data?: AnswerRow[] };
        const questionsJson = (await questionsRes.json()) as { data?: QuestionRow[] };
        const byQId = new Map<string, QuestionRow>();
        for (const q of questionsJson.data ?? []) byQId.set(q.id, q);
        const mediaItems: MediaItem[] = [];
        for (const row of answersJson.data ?? []) {
          const q = byQId.get(row.question_id);
          if (!q || !isFileLikeResponseType(q.response_type)) continue;
          const kind = defaultResponseType(q.response_type) as FileResponseType;
          const parsed = parseFileAnswerJson(row.response_text ?? "");
          if (!parsed?.files?.length) continue;
          for (let i = 0; i < parsed.files.length; i++) {
            const url = String(parsed.files[i]?.url ?? "").trim();
            if (!/^https?:\/\//i.test(url)) continue;
            mediaItems.push({ id: `${row.question_id}-${i}`, question: q.question, kind, url });
          }
        }
        setMedia(mediaItems);

        const convJson = (await convRes.json()) as { data?: Array<{ id: string }> };
        const firstConv = convJson.data?.[0];
        if (firstConv?.id) {
          const msgsRes = await fetch(`/api/admin/sms/conversations/${firstConv.id}/messages`, {
            headers: h,
            cache: "no-store",
          });
          const msgsJson = (await msgsRes.json()) as { data?: SmsMessage[] };
          setMessages(msgsJson.data ?? []);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [profileId, tick]);

  const refetch = () => setTick((t) => t + 1);

  return { profile, media, messages, loading, error, refetch };
}

// ── UserPaneInfo (same as MatchViewModal) ─────────────────────────────────────

function UserPaneInfo({ data }: { data: PaneData }) {
  const { profile, media, loading, error } = data;

  if (loading) {
    return <div className="flex h-24 items-center justify-center text-sm text-gray-400">Loading…</div>;
  }
  if (error || !profile) {
    return <p className="p-4 text-sm text-red-500">{error ?? "Profile not found"}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <p className="text-base font-semibold text-gray-800 dark:text-white/90">
          {profile.display_name ?? "—"}
        </p>
        <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
          {[profile.age != null ? `${profile.age} y` : null, profile.height, profile.gender]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="mt-1 font-mono text-xs text-gray-400">{profile.phone_e164}</p>
        {profile.intro_reply_raw && (
          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm italic text-gray-700 dark:bg-white/5 dark:text-gray-200">
            &ldquo;{profile.intro_reply_raw}&rdquo;
          </p>
        )}
      </div>

      {media.length > 0 && (
        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Photos & Media
          </p>
          <div className="grid grid-cols-2 gap-3">
            {media.map((item) => (
              <div
                key={item.id}
                className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <p className="bg-gray-50 px-2 py-1 text-xs text-gray-500 dark:bg-white/5">{item.question}</p>
                <div className="p-2">
                  <MediaFilePreview kind={item.kind} sourceUrl={item.url} isLocal={false} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── UserPaneChat (same as MatchViewModal) ─────────────────────────────────────

function UserPaneChat({
  data,
  phoneE164,
  onMessageSent,
  matchId,
  slot,
  autoReplyEnabled,
  onAutoReplyToggled,
}: {
  data: PaneData;
  phoneE164?: string | null;
  onMessageSent?: () => void;
  matchId: string;
  slot: "a" | "b";
  autoReplyEnabled: boolean;
  onAutoReplyToggled: (enabled: boolean) => void;
}) {
  const { messages, loading } = data;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [togglingAI, setTogglingAI] = useState(false);

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function send() {
    const msg = draft.trim();
    if (!msg || !phoneE164) return;
    setSending(true);
    setSendError(null);
    setSent(false);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const res = await fetch("/api/admin/sms/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: phoneE164, message: msg, provider: "linq" }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to send");
      }
      setDraft("");
      setSent(true);
      onMessageSent?.();
      setTimeout(() => setSent(false), 2000);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed");
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
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">SMS Chat</p>
      </div>
      <div className="max-h-[420px] min-h-[200px] space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-400">No messages yet.</p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.direction === "inbound"
                  ? "bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-white/90"
                  : "ml-auto bg-[#0e9f6e] text-white"
              }`}
            >
              <p>{msg.body || "—"}</p>
              {fmtDate(msg.created_at) && (
                <p
                  className={`mt-1 text-[10px] ${
                    msg.direction === "inbound" ? "text-gray-400" : "text-white/60"
                  }`}
                >
                  {fmtDate(msg.created_at)}
                </p>
              )}
            </div>
          ))
        )}
      </div>
      {phoneE164 && (
        <div className="border-t border-gray-100 p-3 dark:border-gray-700">
          {sendError && <p className="mb-1.5 text-xs text-red-500">{sendError}</p>}
          <div className="mb-2 flex justify-end">
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
              placeholder="Message as Inyo…"
              disabled={sending}
              className="flex-1 resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0e9f6e] focus:outline-none disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900/40 dark:text-white/90"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              className="self-end rounded-lg bg-[#0e9f6e] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {sent ? "✓" : sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── GroupChatPane ─────────────────────────────────────────────────────────────

function GroupChatPane({
  linqChatId,
  profileA,
  profileB,
}: {
  linqChatId: string | null;
  profileA: IntroProfile | null;
  profileB: IntroProfile | null;
}) {
  const [messages, setMessages] = useState<LinqMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!linqChatId) return;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        if (!accessToken) { setError("Not authenticated."); setLoading(false); return; }
        const h = { Authorization: `Bearer ${accessToken}` };
        const res = await fetch(`/api/admin/linq/chats/${linqChatId}/messages`, {
          headers: h,
          cache: "no-store",
        });
        const json = (await res.json()) as { messages?: LinqMessage[]; data?: LinqMessage[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        const raw = json.messages ?? json.data ?? [];
        // Sort oldest → newest so conversation reads top-to-bottom
        const sorted = [...raw].sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b));
        setMessages(sorted);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load group chat");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [linqChatId]);

  // Build normalized phone → name map (last 10 digits for reliable matching)
  const phoneToName = new Map<string, string>();
  if (profileA?.phone_e164) phoneToName.set(normalizePhone(profileA.phone_e164), profileA.display_name ?? "User A");
  if (profileB?.phone_e164) phoneToName.set(normalizePhone(profileB.phone_e164), profileB.display_name ?? "User B");

  function senderLabel(msg: LinqMessage): string {
    if (msg.sender_handle?.is_me) return "system";
    const raw = extractSenderPhone(msg);
    const norm = normalizePhone(raw);
    if (norm && phoneToName.has(norm)) return phoneToName.get(norm)!;
    // If sender is unrecognised (not A or B) they are the system number
    if (norm && !phoneToName.has(norm)) return "system";
    return raw || "Unknown";
  }

  function messageText(msg: LinqMessage): string {
    if (!msg.parts?.length) return "";
    return msg.parts
      .filter((p) => p.type === "text")
      .map((p) => p.value ?? "")
      .join(" ")
      .trim();
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Group Chat</p>
        {linqChatId && (
          <p className="font-mono text-[10px] text-gray-400">{linqChatId}</p>
        )}
      </div>
      <div className="max-h-[420px] min-h-[200px] space-y-3 overflow-y-auto p-4">
        {!linqChatId ? (
          <p className="text-sm text-gray-400">No group chat created yet.</p>
        ) : loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-400">No messages in group chat.</p>
        ) : (
          messages.map((msg) => {
            const text = messageText(msg);
            const label = senderLabel(msg);
            const isMe = label === "system";
            return (
              <div
                key={msg.id}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  isMe
                    ? "ml-auto bg-[#0e9f6e] text-white"
                    : "bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-white/90"
                }`}
              >
                {!isMe && (
                  <p className="mb-0.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                    {label}
                  </p>
                )}
                <p>{text || "—"}</p>
                {fmtDate(extractMessageTimestamp(msg)) && (
                  <p className={`mt-1 text-[10px] ${isMe ? "text-white/60" : "text-gray-400"}`}>
                    {fmtDate(extractMessageTimestamp(msg))}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── MatchDetailSection ────────────────────────────────────────────────────────

function MatchDetailSection({
  match,
  onAutoReplyToggled,
}: {
  match: IntroducedMatch;
  onAutoReplyToggled: (slot: "a" | "b", enabled: boolean) => void;
}) {
  const dataA = useUserPaneData(match.user_a_id);
  const dataB = useUserPaneData(match.user_b_id);

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-5 dark:border-gray-800 dark:bg-white/[0.02]">
      {/* Row 1: Profile cards */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {profileLabel(match.user_a)} — Profile
          </p>
          <UserPaneInfo data={dataA} />
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {profileLabel(match.user_b)} — Profile
          </p>
          <UserPaneInfo data={dataB} />
        </div>
      </div>

      {/* Row 2: SMS chats */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {profileLabel(match.user_a)} — SMS
          </p>
          <UserPaneChat
            data={dataA}
            phoneE164={dataA.profile?.phone_e164}
            onMessageSent={() => void dataA.refetch?.()}
            matchId={match.id}
            slot="a"
            autoReplyEnabled={match.user_a_auto_reply_enabled}
            onAutoReplyToggled={(enabled) => onAutoReplyToggled("a", enabled)}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {profileLabel(match.user_b)} — SMS
          </p>
          <UserPaneChat
            data={dataB}
            phoneE164={dataB.profile?.phone_e164}
            onMessageSent={() => void dataB.refetch?.()}
            matchId={match.id}
            slot="b"
            autoReplyEnabled={match.user_b_auto_reply_enabled}
            onAutoReplyToggled={(enabled) => onAutoReplyToggled("b", enabled)}
          />
        </div>
      </div>

      {/* Row 3: Group chat */}
      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Group Chat
        </p>
        <GroupChatPane
          linqChatId={match.linq_chat_id}
          profileA={match.user_a}
          profileB={match.user_b}
        />
      </div>
    </div>
  );
}

// ── IntroducedMatchesPanel (main export) ──────────────────────────────────────

export default function IntroducedMatchesPanel() {
  const [matches, setMatches] = useState<IntroducedMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>({});
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function getToken(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  useEffect(() => {
    void (async () => {
      const t = await getToken();
      if (!t) {
        setError("Not authenticated.");
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/admin/matches/introduced", {
          headers: { Authorization: `Bearer ${t}` },
          cache: "no-store",
        });
        const json = (await res.json()) as { data?: IntroducedMatch[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load matches");
        setMatches(json.data ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isUnread(m: IntroducedMatch): boolean {
    if (!m.last_inbound_at) return false;
    if (!m.admin_read_at) return true;
    return new Date(m.last_inbound_at) > new Date(m.admin_read_at);
  }

  async function markRead(matchId: string) {
    const token = await getToken();
    if (!token) return;
    await fetch("/api/admin/matches/mark-read", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ matchId }),
    });
    setMatches((prev) =>
      prev.map((m) => m.id === matchId ? { ...m, admin_read_at: new Date().toISOString() } : m),
    );
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    const match = matches.find((m) => m.id === id);
    if (match && isUnread(match) && !expandedIds.has(id)) void markRead(id);
  }

  async function deleteMatch(matchId: string) {
    if (!confirm("Delete this match permanently? This cannot be undone.")) return;
    const token = await getToken();
    if (!token) return;
    setDeleteError(null);
    setDeleteLoading((prev) => ({ ...prev, [matchId]: true }));
    try {
      const res = await fetch("/api/admin/matches/action", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", matchId }),
      });
      if (res.ok) {
        setMatches((prev) => prev.filter((m) => m.id !== matchId));
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteError(err.error ?? "Delete failed.");
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeleteLoading((prev) => { const next = { ...prev }; delete next[matchId]; return next; });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Introduced Matches</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            All matches that have been connected via group chat. Click a row to expand details.
          </p>
        </div>

        <div className="px-5 py-4">
          {loading && (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          )}
          {(error ?? deleteError) && (
            <p className="text-sm text-red-500">{error ?? deleteError}</p>
          )}
          {!loading && !error && matches.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No introduced matches yet.</p>
          )}
        </div>

        {matches.length > 0 && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {matches.map((match) => {
              const isExpanded = expandedIds.has(match.id);
              const rowUnread = isUnread(match);
              const nameA = profileLabel(match.user_a);
              const nameB = profileLabel(match.user_b);
              const cityA = match.user_a?.city ?? null;
              const cityB = match.user_b?.city ?? null;
              const city = cityA === cityB ? cityA : [cityA, cityB].filter(Boolean).join(" / ") || null;

              return (
                <div key={match.id}>
                  {/* Card row */}
                  <div className="flex w-full items-center gap-2 pr-4 transition hover:bg-gray-50/80 dark:hover:bg-white/[0.03]">
                    <button
                      type="button"
                      onClick={() => toggleExpand(match.id)}
                      className="flex flex-1 items-start justify-between gap-4 px-5 py-4 text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="select-none text-xs text-gray-400">
                          {isExpanded ? "▾" : "▸"}
                        </span>
                        <div>
                          <p className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-white/90">
                            {nameA} × {nameB}
                            {rowUnread && (
                              <span className="inline-block h-2 w-2 rounded-full bg-red-500" title="New message" />
                            )}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            {city && <span>{city}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-gray-400">
                          {fmtDateShort(match.gc_created_at) || "—"}
                        </p>
                        <span className="mt-0.5 inline-block rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
                          connected
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteMatch(match.id)}
                      disabled={deleteLoading[match.id]}
                      className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-red-400"
                    >
                      {deleteLoading[match.id] ? "…" : "Delete"}
                    </button>
                  </div>

                  {/* Expanded detail section */}
                  {isExpanded && (
                    <MatchDetailSection
                      match={match}
                      onAutoReplyToggled={(slot, enabled) =>
                        setMatches((prev) =>
                          prev.map((m) =>
                            m.id === match.id
                              ? { ...m, [`user_${slot}_auto_reply_enabled`]: enabled }
                              : m
                          )
                        )
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
