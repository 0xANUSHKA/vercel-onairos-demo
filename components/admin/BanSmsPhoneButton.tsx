"use client";

import { supabase } from "@/lib/supabase";
import { useState } from "react";

type Props = {
  phoneE164: string;
  /** Shown in POST body for audit */
  reason?: string;
  /** Called after a successful ban */
  onBanned?: () => void;
  /** Table row: small text link. Detail: bordered button. */
  variant?: "table" | "detail";
};

export function BanSmsPhoneButton({
  phoneE164,
  reason = "admin participants ban",
  onBanned,
  variant = "table",
}: Props) {
  const [banning, setBanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ban() {
    const p = phoneE164.trim();
    if (!p) return;
    if (!window.confirm(`Ban ${p} from SMS bot and new waitlist joins?`)) return;
    setBanning(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("Not signed in.");
        return;
      }
      const res = await fetch("/api/admin/sms-phone-bans", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone_e164: p, reason }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? "Ban failed");
        return;
      }
      onBanned?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ban failed");
    } finally {
      setBanning(false);
    }
  }

  if (variant === "detail") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <button
          type="button"
          onClick={() => void ban()}
          disabled={banning}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900/40 dark:text-white/90 dark:hover:bg-gray-800"
        >
          {banning ? "Banning…" : "Ban SMS"}
        </button>
        {error && <span className="max-w-[14rem] text-right text-xs text-error-500">{error}</span>}
      </div>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => void ban()}
        disabled={banning}
        className="text-xs font-medium text-error-600 hover:underline disabled:opacity-50 dark:text-error-400"
      >
        {banning ? "Banning…" : "Ban SMS"}
      </button>
      {error && <span className="max-w-[10rem] text-right text-[10px] text-error-500">{error}</span>}
    </span>
  );
}
