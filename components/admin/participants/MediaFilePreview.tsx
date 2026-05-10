"use client";

import {
  RESPONSE_TYPE_AUDIO,
  RESPONSE_TYPE_FILE,
  RESPONSE_TYPE_IMAGE,
  RESPONSE_TYPE_VIDEO,
  type FileResponseType,
} from "@/lib/question-response";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  kind: FileResponseType;
  /** `blob:` URL for a not-yet-uploaded file, or `https://` for saved / post-upload */
  sourceUrl: string | null;
  isLocal: boolean;
  fileName?: string;
};

function ImageLightbox({
  src,
  alt,
  open,
  onClose,
}: {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}) {
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [open, onKeyDown]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Full image"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl leading-none text-white transition hover:bg-white/20"
        aria-label="Close"
      >
        ×
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-[min(92vh,1200px)] max-w-[min(92vw,1200px)] object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}

function ClickableImageThumbnail({
  sourceUrl,
  alt,
}: {
  sourceUrl: string;
  alt: string;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="group mt-2 block max-h-48 max-w-sm overflow-hidden rounded-md border border-gray-200 text-left transition hover:border-[#0e9f6e] hover:ring-2 hover:ring-[#0e9f6e]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e9f6e] dark:border-gray-600 dark:hover:border-[#0e9f6e]"
        title="Click to view full size"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sourceUrl}
          alt={alt}
          className="h-auto w-full object-contain transition group-hover:opacity-95"
        />
      </button>
      <ImageLightbox src={sourceUrl} alt={alt} open={lightboxOpen} onClose={() => setLightboxOpen(false)} />
    </>
  );
}

export default function MediaFilePreview({ kind, sourceUrl, isLocal, fileName }: Props) {
  if (!sourceUrl) return null;

  if (isLocal) {
    if (kind === RESPONSE_TYPE_IMAGE) {
      return <ClickableImageThumbnail sourceUrl={sourceUrl} alt={fileName ?? "Preview"} />;
    }
    if (kind === RESPONSE_TYPE_VIDEO) {
      return (
        <video
          className="mt-2 max-h-56 w-full max-w-md rounded-md border border-gray-200 dark:border-gray-600"
          controls
          src={sourceUrl}
          playsInline
        />
      );
    }
    if (kind === RESPONSE_TYPE_AUDIO) {
      return <audio className="mt-2 w-full max-w-md" controls src={sourceUrl} />;
    }
    if (kind === RESPONSE_TYPE_FILE) {
      return (
        <div className="mt-2 rounded-md border border-amber-200/80 bg-amber-50/50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100/90">
          <span className="font-medium">{fileName ?? "File"}</span> — not uploaded to Cloudinary yet. Click
          <strong> Save answers</strong> to upload and persist.
        </div>
      );
    }
  }

  // Saved remote URLs
  if (kind === RESPONSE_TYPE_IMAGE) {
    return <ClickableImageThumbnail sourceUrl={sourceUrl} alt={fileName ?? "Uploaded image"} />;
  }
  if (kind === RESPONSE_TYPE_VIDEO) {
    return (
      <video
        className="mt-2 max-h-56 w-full max-w-md rounded-md border border-gray-200 dark:border-gray-600"
        controls
        src={sourceUrl}
        playsInline
      />
    );
  }
  if (kind === RESPONSE_TYPE_AUDIO) {
    return <audio className="mt-2 w-full max-w-md" controls src={sourceUrl} />;
  }
  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-flex break-all text-xs text-[#0e9f6e] hover:underline"
    >
      {fileName || sourceUrl}
    </a>
  );
}
