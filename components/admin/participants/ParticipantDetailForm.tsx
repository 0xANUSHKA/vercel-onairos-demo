"use client";

import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { BanSmsPhoneButton } from "@/components/admin/BanSmsPhoneButton";
import ParticipantSmsChatBoard from "./ParticipantSmsChatBoard";

type WaitlistInfo = { id: string; value: string; city?: string; created_at?: string };

type Profile = {
  id: string;
  phone_e164: string;
  gender: string | null;
  display_name: string | null;
  age: number | null;
  height: string | null;
  intro_reply_raw: string | null;
  intro_nlp_model?: string | null;
  intro_nlp_version?: string | null;
  updated_at?: string;
  waitlist: WaitlistInfo | null;
};

export default function ParticipantDetailForm() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";

  const from = searchParams.get("from");
  const backToList = useMemo(() => {
    if (from === "complete_male")
      return { href: "/admin/participants/complete/male", label: "← Male participants (complete)" };
    if (from === "complete_female")
      return { href: "/admin/participants/complete/female", label: "← Female participants (complete)" };
    return { href: "/admin/participants", label: "← All participants" };
  }, [from]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackEdit, setTrackEdit] = useState<"" | "MALE" | "FEMALE">("");
  const [savingTrack, setSavingTrack] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError("You are not authenticated.");
      setLoading(false);
      return;
    }
    const h = { Authorization: `Bearer ${session.access_token}` };
    const pRes = await fetch(`/api/admin/profiles/${id}`, { headers: h, cache: "no-store" });
    const pJson = (await pRes.json()) as { data?: Profile; error?: string };

    if (!pRes.ok) {
      setError(pJson.error ?? "Failed to load profile.");
      setProfile(null);
      setLoading(false);
      return;
    }
    const prof = pJson.data ?? null;
    setProfile(prof);
    const g = prof?.gender;
    setTrackEdit(g === "MALE" || g === "FEMALE" ? g : "");

    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const trackSaveDisabled = useMemo(() => {
    if (savingTrack) return true;
    const want = trackEdit === "" ? null : trackEdit;
    const cur = profile?.gender ?? null;
    return want === cur;
  }, [savingTrack, trackEdit, profile?.gender]);

  async function authHeader() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not authenticated");
    return {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    } as const;
  }

  async function saveTrack() {
    if (!id) return;
    setSavingTrack(true);
    setError(null);
    try {
      const headers = await authHeader();
      const genderPayload =
        trackEdit === "MALE" || trackEdit === "FEMALE" ? trackEdit : null;
      const res = await fetch(`/api/admin/profiles/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ gender: genderPayload }),
      });
      const payload = (await res.json()) as { data?: Profile; error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Could not update track.");
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update track.");
    } finally {
      setSavingTrack(false);
    }
  }

  async function deleteProfilePermanently() {
    if (!id) return;
    const ok = window.confirm(
      "Delete this profile permanently? This action cannot be undone and will remove onboarding data for this participant."
    );
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/profiles/${id}`, {
        method: "DELETE",
        headers: await authHeader(),
      });
      const payload = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !payload.success) {
        setError(payload.error ?? "Failed to delete profile.");
        return;
      }
      router.push(backToList.href);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete profile.");
    } finally {
      setDeleting(false);
    }
  }

  if (!id) {
    return <p className="text-sm text-gray-500">Missing profile id.</p>;
  }
  if (loading) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }
  if (error && !profile) {
    return (
      <div className="text-sm text-error-500">
        {error}
        <div className="mt-2">
          <Link href={backToList.href} className="text-[#0e9f6e] hover:underline">
            {backToList.label}
          </Link>
        </div>
      </div>
    );
  }
  if (!profile) {
    return null;
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-error-500">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Participant details</h2>
          <p className="font-mono text-sm text-gray-600 dark:text-gray-300">{profile.phone_e164}</p>
          {profile.waitlist && (
            <p className="text-xs text-gray-500">Waitlist · {formatWL(profile.waitlist)}</p>
          )}
          {(profile.display_name != null || profile.age != null || profile.height || profile.gender) && (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
              {profile.display_name ?? "—"} · {profile.age ?? "—"} y · {profile.height ?? "—"} ·{" "}
              {profile.gender ?? "—"}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="max-w-md rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="participant-track"
                className="text-xs font-medium text-gray-600 dark:text-gray-300"
              >
                Onboarding track
              </label>
              <select
                id="participant-track"
                value={trackEdit}
                onChange={(e) =>
                  setTrackEdit((e.target.value as "" | "MALE" | "FEMALE") || "")
                }
                disabled={savingTrack}
                className="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-900/40 dark:text-white/90"
              >
                <option value="">Not set</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
              <button
                type="button"
                onClick={() => void saveTrack()}
                disabled={trackSaveDisabled}
                className="inline-flex h-9 items-center justify-center rounded-md bg-[#0e9f6e] px-3 text-xs font-medium text-white disabled:opacity-50"
              >
                {savingTrack ? "Saving…" : "Save track"}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Male ↔ female remaps answers by question order for each track.
            </p>
          </div>
          <BanSmsPhoneButton
            variant="detail"
            phoneE164={profile.phone_e164}
            reason="admin participant detail ban"
          />
          <button
            type="button"
            onClick={() => void deleteProfilePermanently()}
            disabled={deleting}
            className="rounded-lg border border-error-300 px-3 py-1.5 text-xs font-medium text-error-600 hover:bg-error-50 disabled:opacity-50 dark:border-error-700 dark:text-error-300 dark:hover:bg-error-500/10"
          >
            {deleting ? "Deleting..." : "Delete permanently"}
          </button>
          <Link href={backToList.href} className="text-sm text-[#0e9f6e] hover:underline">
            {backToList.label}
          </Link>
        </div>
      </div>
      <ParticipantSmsChatBoard phoneE164={profile.phone_e164} profileId={profile.id} />
    </div>
  );
}

function formatWL(w: WaitlistInfo) {
  const t = w.created_at ? new Date(w.created_at).toLocaleString() : "";
  return `${w.value}${w.city ? ` · ${w.city}` : ""}${t ? ` · ${t}` : ""}`;
}
