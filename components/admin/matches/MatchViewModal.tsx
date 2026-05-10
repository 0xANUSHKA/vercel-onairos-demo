"use client";

import { useEffect, useState } from "react";
import {
  defaultResponseType,
  isFileLikeResponseType,
  parseFileAnswerJson,
  type FileResponseType,
} from "@/lib/question-response";
import MediaFilePreview from "@/components/admin/participants/MediaFilePreview";
import { supabase } from "@/lib/supabase";

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

function fmtDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

type PaneData = {
  profile: Profile | null;
  media: MediaItem[];
  messages: SmsMessage[];
  loading: boolean;
  error: string | null;
};

function useUserPaneData(profileId: string): PaneData {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) { setError("Not authenticated."); setLoading(false); return; }
        const h = { Authorization: `Bearer ${token}` };

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
  }, [profileId]);

  return { profile, media, messages, loading, error };
}

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
      {/* Profile card */}
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

      {/* Media */}
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

function UserPaneChat({ data }: { data: PaneData }) {
  const { messages, loading } = data;

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
    </div>
  );
}

export function MatchViewModal({
  userAId,
  userBId,
  matchLabel,
  onClose,
}: {
  userAId: string;
  userBId: string;
  matchLabel: string;
  onClose: () => void;
}) {
  const dataA = useUserPaneData(userAId);
  const dataB = useUserPaneData(userBId);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative mb-4 mt-4 w-full max-w-6xl rounded-2xl bg-white shadow-2xl dark:bg-gray-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Match Preview</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{matchLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Profile + media — each column independent height */}
        <div className="grid grid-cols-1 gap-6 p-6 pb-0 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Participant A
            </p>
            <UserPaneInfo data={dataA} />
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Participant B
            </p>
            <UserPaneInfo data={dataB} />
          </div>
        </div>

        {/* SMS chats — always on the same line regardless of photo heights */}
        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
          <UserPaneChat data={dataA} />
          <UserPaneChat data={dataB} />
        </div>
      </div>
    </div>
  );
}
