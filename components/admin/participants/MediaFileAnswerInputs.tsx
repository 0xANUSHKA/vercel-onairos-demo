"use client";

import {
  RESPONSE_TYPE_AUDIO,
  RESPONSE_TYPE_FILE,
  RESPONSE_TYPE_IMAGE,
  RESPONSE_TYPE_VIDEO,
  type FileResponseType,
  parseFileAnswerJson,
  stringifyFileAnswer,
} from "@/lib/question-response";
import { type CloudinaryResource, responseTypeToCloudinaryResource } from "@/lib/cloudinary-resource-type";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import MediaFilePreview from "./MediaFilePreview";

type MediaKind = FileResponseType;

type Slot =
  | { t: "empty" }
  | { t: "remote"; url: string }
  | { t: "local"; file: File; objectUrl: string; name: string };

export type MediaFileHandle = {
  /** Upload all local files to Cloudinary, merge into one JSON, notify parent, return that JSON. */
  flush: () => Promise<string>;
};

type Props = {
  profileId: string;
  value: string;
  onChange: (json: string) => void;
  mediaKind: MediaKind;
  getAuthHeader: () => Promise<Record<string, string>>;
  disabled?: boolean;
};

function acceptForKind(kind: string): string {
  if (kind === RESPONSE_TYPE_IMAGE) return "image/*";
  if (kind === RESPONSE_TYPE_VIDEO) return "video/*";
  if (kind === RESPONSE_TYPE_AUDIO) return "audio/*,video/*";
  if (kind === RESPONSE_TYPE_FILE) return "*/*";
  return "*/*";
}

function slotsFromValue(value: string): Slot[] {
  const p = parseFileAnswerJson(value);
  if (!p || p.files.length === 0) return [{ t: "empty" }];
  const remotes = p.files
    .map((f) => (f.url ?? "").trim())
    .filter(Boolean)
    .map((url) => ({ t: "remote" as const, url }));
  return remotes.length > 0 ? remotes : [{ t: "empty" }];
}

function revokeSlot(s: Slot) {
  if (s.t === "local") {
    try {
      URL.revokeObjectURL(s.objectUrl);
    } catch {
      /* */
    }
  }
}

function jsonForSlots(slts: Slot[]): string {
  const remotes: { url: string }[] = [];
  for (const s of slts) {
    if (s.t === "remote" && s.url.trim()) remotes.push({ url: s.url });
  }
  return stringifyFileAnswer(remotes);
}

const MediaFileAnswerInputs = forwardRef<MediaFileHandle, Props>(function MediaFileAnswerInputs(
  { profileId, value, onChange, mediaKind, getAuthHeader, disabled },
  ref
) {
  const [slots, setSlots] = useState<Slot[]>(() => slotsFromValue(value));
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const ignoreNextValue = useRef(false);

  useEffect(() => {
    if (ignoreNextValue.current) {
      ignoreNextValue.current = false;
      return;
    }
    setSlots((prev) => {
      for (const s of prev) revokeSlot(s);
      return slotsFromValue(value);
    });
  }, [value]);

  const flush = useCallback(async () => {
    setErr(null);
    let work = slots;
    const toUpload: number[] = [];
    for (let i = 0; i < work.length; i++) {
      if (work[i]!.t === "local") toUpload.push(i);
    }
    if (toUpload.length > 0) {
      setUploading(true);
      const rtype: CloudinaryResource = responseTypeToCloudinaryResource(mediaKind);
      const uploaded: { publicId: string; resourceType: CloudinaryResource }[] = [];
      try {
        const next = [...work] as Slot[];
        for (const i of toUpload) {
          const s = next[i] as Extract<Slot, { t: "local" }>;
          if (s.t !== "local") continue;
          const fd = new FormData();
          fd.set("file", s.file);
          fd.set("expected_type", mediaKind);
          const res = await fetch(`/api/admin/profiles/${profileId}/upload-asset`, {
            method: "POST",
            headers: await getAuthHeader(),
            body: fd,
          });
          const j = (await res.json()) as { url?: string; publicId?: string; error?: string };
          if (!res.ok) throw new Error(j.error ?? "Upload failed.");
          if (!j.url) throw new Error("No file URL returned.");
          if (j.publicId) {
            uploaded.push({ publicId: j.publicId, resourceType: rtype });
          }
          revokeSlot(s);
          next[i] = { t: "remote", url: j.url };
        }
        setSlots(next);
        const out = jsonForSlots(next);
        ignoreNextValue.current = true;
        onChange(out);
        return out;
      } catch (e) {
        for (const u of uploaded) {
          try {
            const h = await getAuthHeader();
            await fetch(`/api/admin/profiles/${profileId}/delete-asset`, {
              method: "POST",
              headers: { ...h, "Content-Type": "application/json" },
              body: JSON.stringify({ publicId: u.publicId, resourceType: u.resourceType }),
            });
          } catch {
            /* best-effort rollback */
          }
        }
        setErr(e instanceof Error ? e.message : "Upload failed.");
        throw e;
      } finally {
        setUploading(false);
      }
    }
    const out = jsonForSlots(work);
    ignoreNextValue.current = true;
    onChange(out);
    return out;
  }, [slots, profileId, mediaKind, getAuthHeader, onChange]);

  useImperativeHandle(ref, () => ({ flush }), [flush]);

  const onPick = (i: number, file: File | null) => {
    if (!file || disabled) return;
    setErr(null);
    setSlots((prev) => {
      const next = [...prev];
      const old = next[i]!;
      revokeSlot(old);
      if (!file) {
        next[i] = { t: "empty" };
      } else {
        const objectUrl = URL.createObjectURL(file);
        next[i] = { t: "local", file, objectUrl, name: file.name };
      }
      return next;
    });
  };

  const clearOrRemove = (i: number) => {
    if (disabled) return;
    setSlots((prev) => {
      const next = [...prev];
      const cur = next[i]!;
      revokeSlot(cur);
      if (next.length > 1) {
        next.splice(i, 1);
      } else {
        next[0] = { t: "empty" };
      }
      return next;
    });
  };

  const addSlot = () => {
    if (disabled) return;
    setSlots((s) => [...s, { t: "empty" }]);
  };

  const hint =
    mediaKind === RESPONSE_TYPE_IMAGE
      ? "Local preview; nothing is sent to Cloudinary until you save answers."
      : mediaKind === RESPONSE_TYPE_VIDEO
        ? "Local preview; upload runs when you save answers."
        : mediaKind === RESPONSE_TYPE_AUDIO
          ? "Local preview; upload runs when you save answers."
          : "Selected files upload to Cloudinary when you save answers (no orphan uploads on refresh).";

  return (
    <div className="mt-2 space-y-2">
      {err && <p className="text-sm text-error-500">{err}</p>}
      <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      <ul className="space-y-3">
        {slots.map((slot, i) => (
          <li
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
          >
            <span className="text-xs text-gray-500">File {i + 1}</span>
            {slot.t === "remote" && (
              <MediaFilePreview
                kind={mediaKind}
                sourceUrl={slot.url}
                isLocal={false}
                fileName={undefined}
              />
            )}
            {slot.t === "local" && (
              <MediaFilePreview
                kind={mediaKind}
                sourceUrl={slot.objectUrl}
                isLocal
                fileName={slot.name}
              />
            )}
            {slot.t === "empty" && <p className="text-xs text-gray-400">No file selected</p>}
            <div className="flex flex-wrap items-center gap-2">
              {!disabled && (
                <label>
                  <input
                    type="file"
                    accept={acceptForKind(String(mediaKind))}
                    className="sr-only"
                    disabled={!!uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      if (f) onPick(i, f);
                    }}
                  />
                  <span className="inline-block cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900/40 dark:text-white/90">
                    {uploading
                      ? "…"
                      : slot.t === "local" || slot.t === "remote"
                        ? "Replace"
                        : "Choose file"}
                  </span>
                </label>
              )}
              {!disabled && (slot.t !== "empty" || slots.length > 1) && (
                <button
                  type="button"
                  className="text-xs text-error-600 hover:underline dark:text-error-400"
                  onClick={() => clearOrRemove(i)}
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!disabled && (
        <button
          type="button"
          onClick={addSlot}
          className="text-sm text-[#0e9f6e] hover:underline"
        >
          + Add another file
        </button>
      )}
    </div>
  );
});

export default MediaFileAnswerInputs;
