"use client";

import SmsConversationsPanel from "@/components/admin/sms/SmsConversationsPanel";
import { DEFAULT_SMS_PROVIDER } from "@/lib/sms-defaults";
import { supabase } from "@/lib/supabase";
import { useState } from "react";

type SmsTestResponse = {
  id?: string;
  to?: string;
  from?: string;
  provider?: "telnyx" | "linq";
  error?: string;
};

const US_E164_REGEX = /^\+1\d{10}$/;

export default function SmsTestForm() {
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("Demo SMS from inyo admin via Linq.");
  const [provider, setProvider] = useState<"telnyx" | "linq">(DEFAULT_SMS_PROVIDER);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SmsTestResponse | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  async function authHeaders() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("You are not authenticated. Please sign in again.");
    return {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    };
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedTo = to.trim();
    const trimmedMessage = message.trim();

    if (!US_E164_REGEX.test(trimmedTo)) {
      setError("Destination must be a US number in E.164 format, e.g. +14155550123.");
      return;
    }
    if (!trimmedMessage) {
      setError("Message is required.");
      return;
    }

    setSending(true);
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/sms/test", {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: trimmedTo,
          message: trimmedMessage,
          provider,
        }),
      });

      const payload = (await response.json()) as SmsTestResponse;
      if (!response.ok) {
        setError(payload.error ?? "Failed to send SMS.");
        return;
      }

      setSuccess(payload);
      setRefreshSignal((n) => n + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send SMS.";
      setError(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.02]">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">SMS Provider Test</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Send a demo SMS to a US number. Use E.164 format like <span className="font-medium">+14155550123</span>.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "telnyx" | "linq")}
              className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
            >
              <option value="linq">Linq</option>
              <option value="telnyx">Telnyx</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Destination (US number)
            </label>
            <input
              type="tel"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="+14155550123"
              className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={500}
              className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:text-white/90"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={sending}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
            >
              {sending ? "Sending..." : "Send test SMS"}
            </button>
          </div>
        </form>

        {error && <p className="mt-3 text-sm text-error-500">{error}</p>}
        {success?.id && (
          <div className="mt-3 rounded-lg border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300">
            SMS queued successfully via {success.provider ?? provider}. Message id:{" "}
            <span className="font-medium">{success.id}</span>
          </div>
        )}
      </section>

      <SmsConversationsPanel refreshSignal={refreshSignal} />
    </div>
  );
}
