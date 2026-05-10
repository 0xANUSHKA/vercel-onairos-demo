"use client";

import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { useEffect, useState } from "react";
import {
  externalBrowserHandoffUrl,
  joininyoLandingCleanUrl,
} from "@/lib/social-landing-handoff";

export function SocialInAppBrowserModal() {
  const [socialCopyHint, setSocialCopyHint] = useState<string | null>(null);
  const [landingCleanHttps, setLandingCleanHttps] = useState("");
  const [landingHandoffHref, setLandingHandoffHref] = useState("");

  useEffect(() => {
    const https = joininyoLandingCleanUrl();
    setLandingCleanHttps(https);
    setLandingHandoffHref(externalBrowserHandoffUrl(https));
  }, []);

  const openInBrowserUsesSafariScheme = landingHandoffHref.startsWith("x-safari-https:");

  async function copyLandingCleanUrl() {
    const text = joininyoLandingCleanUrl();
    if (!text) return;
    try {
      await window.navigator.clipboard.writeText(text);
      setSocialCopyHint("Site link copied. Paste it into Safari or Chrome.");
      window.setTimeout(() => setSocialCopyHint(null), 3500);
    } catch {
      setSocialCopyHint("Copy blocked — long-press the link in your browser menu if you can.");
      window.setTimeout(() => setSocialCopyHint(null), 4500);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="social-referrer-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(15, 23, 42, 0.42)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 16,
          padding: "24px 22px",
          background: "#fff",
          boxShadow: "0 24px 48px rgba(0,0,0,0.18)",
          border: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        
        {landingHandoffHref ? (
          <div style={{ marginBottom: 12 }}>
            <LiquidButton
              type="button"
              size="xl"
              className="liquid-button w-full"
              style={{ width: "100%" }}
              onClick={() => {
                if (openInBrowserUsesSafariScheme) {
                  window.location.assign(landingHandoffHref);
                } else {
                  window.open(landingHandoffHref, "_blank", "noopener,noreferrer");
                }
              }}
            >
              Open joininyo.com in browser
            </LiquidButton>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#64748b", marginBottom: 12 }}>Preparing link…</p>
        )}
        {socialCopyHint && (
          <p style={{ marginTop: 12, fontSize: 14, color: "#0e9f6e", fontWeight: 500 }}>{socialCopyHint}</p>
        )}
      </div>
    </div>
  );
}
