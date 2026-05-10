"use client";

import { DEFAULT_SMS_PROVIDER } from "@/lib/sms-defaults";
import MediaFilePreview from "@/components/admin/participants/MediaFilePreview";
import {
  defaultResponseType,
  isFileLikeResponseType,
  labelForResponseType,
  parseFileAnswerJson,
  type FileResponseType,
} from "@/lib/question-response";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useMemo, useState } from "react";

type SmsConversation = {
  id: string;
  participant_phone_e164: string;
  telnyx_phone_e164: string;
  provider?: "telnyx" | "linq";
  last_message_at?: string;
};

type SmsMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  provider?: "telnyx" | "linq";
  status?: string | null;
  created_at: string;
};

type AnswerRow = {
  question_id: string;
  response_text: string;
};

type QuestionRow = {
  id: string;
  question: string;
  response_type?: string | null;
};

type UploadedMediaItem = {
  id: string;
  question: string;
  kind: FileResponseType;
  url: string;
};

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default function ParticipantSmsChatBoard({
  phoneE164,
  profileId,
}: {
  phoneE164: string;
  profileId?: string;
}) {
  const [conversations, setConversations] = useState<SmsConversation[]>([]);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyProvider, setReplyProvider] = useState<"telnyx" | "linq">(DEFAULT_SMS_PROVIDER);
  const [sendingReply, setSendingReply] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMediaItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You are not authenticated. Please sign in again.");
    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

  const fetchConversations = useCallback(async () => {
    setLoadingConversations(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/admin/sms/conversations/by-phone?phone=${encodeURIComponent(phoneE164)}`, {
        headers,
        cache: "no-store",
      });
      const payload = (await res.json()) as { data?: SmsConversation[]; error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Failed to load conversations.");
      const list = payload.data ?? [];
      setConversations(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load conversations.";
      setError(message);
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, [authHeaders, phoneE164]);

  const fetchMessages = useCallback(
    async (conversationId: string) => {
      setLoadingMessages(true);
      setError(null);
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/admin/sms/conversations/${conversationId}/messages`, {
          headers,
          cache: "no-store",
        });
        const payload = (await res.json()) as { data?: SmsMessage[]; error?: string };
        if (!res.ok) throw new Error(payload.error ?? "Failed to load messages.");
        setMessages(payload.data ?? []);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load messages.";
        setError(message);
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    [authHeaders]
  );

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void fetchMessages(selectedId);
  }, [selectedId, fetchMessages]);

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  const fetchUploadedMedia = useCallback(async () => {
    if (!profileId) {
      setUploadedMedia([]);
      return;
    }
    setLoadingMedia(true);
    try {
      const headers = await authHeaders();
      const [answersRes, questionsRes] = await Promise.all([
        fetch(`/api/admin/profiles/${profileId}/answers`, { headers, cache: "no-store" }),
        fetch("/api/admin/questions", { headers, cache: "no-store" }),
      ]);
      const answersPayload = (await answersRes.json()) as { data?: AnswerRow[]; error?: string };
      const questionsPayload = (await questionsRes.json()) as { data?: QuestionRow[]; error?: string };
      if (!answersRes.ok) throw new Error(answersPayload.error ?? "Failed to load uploaded media.");
      if (!questionsRes.ok) throw new Error(questionsPayload.error ?? "Failed to load uploaded media.");

      const byQuestion = new Map<string, QuestionRow>();
      for (const q of questionsPayload.data ?? []) byQuestion.set(q.id, q);

      const media: UploadedMediaItem[] = [];
      for (const row of answersPayload.data ?? []) {
        const q = byQuestion.get(row.question_id);
        if (!q || !isFileLikeResponseType(q.response_type)) continue;
        const kind = defaultResponseType(q.response_type) as FileResponseType;
        const parsed = parseFileAnswerJson(row.response_text ?? "");
        if (!parsed?.files?.length) continue;
        for (let i = 0; i < parsed.files.length; i += 1) {
          const url = String(parsed.files[i]?.url ?? "").trim();
          if (!/^https?:\/\//i.test(url)) continue;
          media.push({
            id: `${row.question_id}-${i}-${url}`,
            question: q.question || labelForResponseType(kind),
            kind,
            url,
          });
        }
      }
      setUploadedMedia(media);
    } catch {
      // Keep the chat usable even if media lookup fails.
      setUploadedMedia([]);
    } finally {
      setLoadingMedia(false);
    }
  }, [authHeaders, profileId]);

  useEffect(() => {
    if (!selectedConversation) return;
    setReplyProvider(selectedConversation.provider ?? DEFAULT_SMS_PROVIDER);
  }, [selectedConversation]);

  useEffect(() => {
    void fetchUploadedMedia();
  }, [fetchUploadedMedia]);

  async function sendReply() {
    const toPhone = selectedConversation?.participant_phone_e164 ?? phoneE164;
    const message = replyBody.trim();
    if (!message) {
      setError("Message is required.");
      return;
    }

    setSendingReply(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/sms/test", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toPhone,
          message,
          provider: replyProvider,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Failed to send message.");

      setReplyBody("");
      await fetchConversations();
      if (selectedConversation?.id) {
        await fetchMessages(selectedConversation.id);
      } else {
        const headers2 = await authHeaders();
        const listRes = await fetch(`/api/admin/sms/conversations/by-phone?phone=${encodeURIComponent(phoneE164)}`, {
          headers: headers2,
          cache: "no-store",
        });
        const listJson = (await listRes.json()) as { data?: SmsConversation[] };
        const first = listJson.data?.[0];
        if (first?.id) {
          setSelectedId(first.id);
          await fetchMessages(first.id);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send message.";
      setError(msg);
    } finally {
      setSendingReply(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">SMS chat board</h3>
          <p className="mt-1 text-xs text-gray-500">Conversation thread for {phoneE164}</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchConversations()}
          disabled={loadingConversations}
          className="inline-flex h-8 items-center justify-center rounded-md bg-[#0e9f6e] px-3 text-xs font-medium text-white disabled:opacity-60"
        >
          {loadingConversations ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-error-500">{error}</p>}

      <div className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Uploaded media</h4>
          {profileId && (
            <button
              type="button"
              onClick={() => void fetchUploadedMedia()}
              disabled={loadingMedia}
              className="inline-flex h-7 items-center justify-center rounded-md border border-gray-200 px-2.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            >
              {loadingMedia ? "Refreshing..." : "Refresh media"}
            </button>
          )}
        </div>
        {loadingMedia ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Loading uploaded media...</p>
        ) : uploadedMedia.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No uploaded media found yet.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {uploadedMedia.map((item) => (
              <div key={item.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">{item.question}</p>
                <MediaFilePreview kind={item.kind} sourceUrl={item.url} isLocal={false} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            {loadingConversations ? (
              <div className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">Loading conversations...</div>
            ) : conversations.length === 0 ? (
              <div className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">No conversation found yet.</div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(conversation.id)}
                      className={`w-full px-4 py-3 text-left transition ${
                        selectedId === conversation.id
                          ? "bg-brand-50 dark:bg-brand-500/15"
                          : "hover:bg-gray-50 dark:hover:bg-white/5"
                      }`}
                    >
                      <div className="text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-gray-300">
                        {(conversation.provider ?? DEFAULT_SMS_PROVIDER).toUpperCase()}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        Last: {formatDate(conversation.last_message_at)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-8">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800">
            <div className="border-b border-gray-100 px-4 py-3 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-300">
              {selectedConversation
                ? `Thread: ${selectedConversation.participant_phone_e164} ↔ ${selectedConversation.telnyx_phone_e164}`
                : "Select a conversation"}
            </div>
            <div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
              {loadingMessages ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading messages...</div>
              ) : messages.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">No messages in this conversation.</div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                      message.direction === "inbound"
                        ? "bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-white/90"
                        : "ml-auto bg-brand-500 text-white"
                    }`}
                  >
                    <p>{message.body || "—"}</p>
                    <p
                      className={`mt-1 text-xs ${
                        message.direction === "inbound" ? "text-gray-500 dark:text-gray-400" : "text-white/80"
                      }`}
                    >
                      {(message.provider ?? DEFAULT_SMS_PROVIDER).toUpperCase()} • {formatDate(message.created_at)}
                      {message.status ? ` • ${message.status}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-gray-100 p-4 dark:border-gray-800">
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {selectedConversation ? "Reply in this thread" : "Send a message (starts a thread)"}
              </label>
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={3}
                placeholder={
                  selectedConversation
                    ? `Send to ${selectedConversation.participant_phone_e164}`
                    : `Send to ${phoneE164}`
                }
                disabled={sendingReply}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#0e9f6e] focus:outline-none disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900/40 dark:text-white/90"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <select
                  value={replyProvider}
                  onChange={(e) => setReplyProvider(e.target.value as "telnyx" | "linq")}
                  disabled={sendingReply}
                  className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-[#0e9f6e] focus:outline-none disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900/40 dark:text-white/90"
                >
                  <option value="linq">Linq</option>
                  <option value="telnyx">Telnyx</option>
                </select>
                <button
                  type="button"
                  onClick={() => void sendReply()}
                  disabled={sendingReply}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-[#0e9f6e] px-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {sendingReply ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
