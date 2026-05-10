"use client";

import { DEFAULT_SMS_PROVIDER } from "@/lib/sms-defaults";
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
  from_phone_e164: string;
  to_phone_e164: string;
  body: string;
  provider?: "telnyx" | "linq";
  event_type?: string | null;
  status?: string | null;
  created_at: string;
};

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default function SmsConversationsPanel({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [conversations, setConversations] = useState<SmsConversation[]>([]);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyProvider, setReplyProvider] = useState<"telnyx" | "linq">(DEFAULT_SMS_PROVIDER);
  const [sendingReply, setSendingReply] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
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
      const res = await fetch("/api/admin/sms/conversations", { headers, cache: "no-store" });
      const payload = (await res.json()) as { data?: SmsConversation[]; error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Failed to load conversations.");
      const list = payload.data ?? [];
      setConversations(list);
      if (!selectedId && list[0]?.id) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load conversations.";
      setError(message);
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, [authHeaders, selectedId]);

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
  }, [fetchConversations, refreshSignal]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void fetchMessages(selectedId);
  }, [fetchMessages, selectedId]);

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  useEffect(() => {
    if (!selectedConversation) return;
    setReplyProvider(selectedConversation.provider ?? DEFAULT_SMS_PROVIDER);
  }, [selectedConversation]);

  async function sendReply() {
    if (!selectedConversation) return;
    const message = replyBody.trim();
    if (!message) {
      setError("Reply message is required.");
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
          to: selectedConversation.participant_phone_e164,
          message,
          provider: replyProvider,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Failed to send reply.");

      setReplyBody("");
      await fetchConversations();
      await fetchMessages(selectedConversation.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send reply.";
      setError(message);
    } finally {
      setSendingReply(false);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">SMS Conversations</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            View inbound replies per phone number thread.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchConversations()}
          disabled={loadingConversations}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-brand-500 px-3 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {loadingConversations ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-error-500">{error}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            {loadingConversations ? (
              <div className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">
                Loading conversations...
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">
                No conversations yet.
              </div>
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
                      <div className="text-sm font-medium text-gray-800 dark:text-white/90">
                        {conversation.participant_phone_e164}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {conversation.provider?.toUpperCase() ?? DEFAULT_SMS_PROVIDER.toUpperCase()} • Last:{" "}
                        {formatDate(conversation.last_message_at)}
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
            <div className="border-b border-gray-100 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300">
              {selectedConversation
                ? `Thread: ${selectedConversation.participant_phone_e164} ↔ ${selectedConversation.telnyx_phone_e164}`
                : "Select a conversation"}
            </div>
            <div className="max-h-[480px] space-y-3 overflow-y-auto p-4">
              {loadingMessages ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading messages...</div>
              ) : messages.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  No messages in this conversation.
                </div>
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
                      {(message.provider ?? DEFAULT_SMS_PROVIDER).toUpperCase()} • {formatDate(message.created_at)}{" "}
                      {message.status ? `• ${message.status}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-gray-100 p-4 dark:border-gray-800">
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Reply to this thread
              </label>
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={3}
                placeholder={
                  selectedConversation
                    ? `Send to ${selectedConversation.participant_phone_e164}`
                    : "Select a conversation first"
                }
                disabled={!selectedConversation || sendingReply}
                className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:opacity-60 dark:border-gray-700 dark:text-white/90"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <select
                  value={replyProvider}
                  onChange={(e) => setReplyProvider(e.target.value as "telnyx" | "linq")}
                  disabled={!selectedConversation || sendingReply}
                  className="h-9 rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:opacity-60 dark:border-gray-700 dark:text-white/90"
                >
                  <option value="linq">Linq</option>
                  <option value="telnyx">Telnyx</option>
                </select>
                <button
                  type="button"
                  onClick={() => void sendReply()}
                  disabled={!selectedConversation || sendingReply}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-brand-500 px-3 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
                >
                  {sendingReply ? "Sending..." : "Send reply"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
