"use client";

import { SocialInAppBrowserModal } from "@/components/social-in-app-browser-modal";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  assertOnairosApiKeyForInit,
  loadOnairosSdk,
} from "@/lib/onairos-web";

interface OnairosButtonProps {
  requestData: Record<string, { type: string; reward: string }>;
  webpageName: string;
  testMode?: boolean;
  autoFetch?: boolean;
  backgroundLoadData?: boolean;
  preferencesMbti?: boolean;
  allowedPlatforms?: string[];
  googleClientId?: string;
  onComplete?: (result: unknown) => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function findFirstStringByKeys(value: unknown, keys: string[], depth = 0): string | null {
  if (depth > 4 || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const found = findFirstStringByKeys(nested, keys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractOnairosCompletionPayload(result: unknown): unknown {
  const root = asRecord(result);
  if (!root) return result;
  const apiResponse = asRecord(root.apiResponse);
  const candidate = (apiResponse ?? root) as Record<string, unknown>;
  const apiUrl = findFirstStringByKeys(candidate, ["apiUrl", "apiURL", "url", "endpoint"]);
  const token = findFirstStringByKeys(candidate, ["token", "authToken", "accessToken"]);
  if (!apiUrl || !token) return result;
  return {
    ...candidate,
    apiUrl,
    token,
  };
}

const SMS_TARGET = process.env.NEXT_PUBLIC_INYO_SMS_TARGET?.trim() ?? "";

function smsHrefToInyo(): string {
  if (!SMS_TARGET) return "";
  return `sms:${SMS_TARGET}`;
}

function openSmsToInyo(): { ok: boolean; showInAppFallback: boolean } {
  if (typeof window === "undefined") return { ok: false, showInAppFallback: false };
  const href = smsHrefToInyo();
  if (!href) return { ok: false, showInAppFallback: false };
  window.location.assign(href);
  setTimeout(() => {
    window.open(href, "_self");
  }, 120);
  const ua = window.navigator.userAgent.toLowerCase();
  const isInAppBrowser = /instagram|fban|fbav|fb_iab|line|wv|snapchat|twitter|tiktok/.test(ua);
  return { ok: true, showInAppFallback: isInAppBrowser };
}

function OnairosConnectInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("t") ?? "";
  const isSocialReferrer = searchParams.get("referer") === "social";
  const onairosInitializedRef = useRef(false);
  const [onairosSdkReady, setOnairosSdkReady] = useState(false);
  const [OnairosButtonComponent, setOnairosButtonComponent] =
    useState<React.ComponentType<OnairosButtonProps> | null>(null);
  const [showSmsFallback, setShowSmsFallback] = useState(false);

  const ONAIROS_API_KEY = process.env.NEXT_PUBLIC_ONAIROS_API_KEY ?? "{Your_API_Key}";
  const ONAIROS_IMPORT_BRIDGE_URL =
    process.env.NEXT_PUBLIC_ONAIROS_IMPORT_BRIDGE_URL ?? "https://onairos.io/extract-data/";
  const ONAIROS_GOOGLE_CLIENT_ID =
    process.env.NEXT_PUBLIC_ONAIROS_GOOGLE_CLIENT_ID ??
    "1030678346906-4npem7vckp0e56p17c81sv2pee2hhule.apps.googleusercontent.com";

  const [resolving, setResolving] = useState(true);
  const [resolvedPhone, setResolvedPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingConnect, setLoadingConnect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function resolveLink() {
      if (!token) {
        setError("Missing Onairos link token.");
        setResolving(false);
        return;
      }
      setResolving(true);
      setError(null);
      try {
        const res = await fetch(`/api/onairos/connect/resolve?t=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const payload = (await res.json()) as { ok?: boolean; phone?: string; error?: string };
        if (!res.ok || !payload.ok) {
          throw new Error(payload.error ?? "Invalid Onairos link.");
        }
        if (!cancelled) {
          setResolvedPhone(payload.phone ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not verify Onairos link.");
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    }
    void resolveLink();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let mounted = true;
    async function bootOnairos() {
      if (isSocialReferrer) return;
      if (resolving || error || !resolvedPhone) return;
      if (onairosInitializedRef.current) return;
      setLoadingConnect(true);
      try {
        assertOnairosApiKeyForInit(ONAIROS_API_KEY);
        const sdk = await loadOnairosSdk();
        setOnairosButtonComponent(() => sdk.OnairosButton as React.ComponentType<OnairosButtonProps>);
        if (!sdk.initializeApiKey) {
          throw new Error("Onairos SDK did not expose initializeApiKey.");
        }
        (
          window as Window & {
            onairosApiKey?: string;
            onairosImportBridgeUrl?: string;
            onairosGoogleClientId?: string;
          }
        ).onairosApiKey = ONAIROS_API_KEY;
        (
          window as Window & {
            onairosApiKey?: string;
            onairosImportBridgeUrl?: string;
            onairosGoogleClientId?: string;
          }
        ).onairosImportBridgeUrl = ONAIROS_IMPORT_BRIDGE_URL;
        (
          window as Window & {
            onairosApiKey?: string;
            onairosImportBridgeUrl?: string;
            onairosGoogleClientId?: string;
          }
        ).onairosGoogleClientId = ONAIROS_GOOGLE_CLIENT_ID;
        await sdk.initializeApiKey({
          apiKey: ONAIROS_API_KEY,
          enableLogging: true,
          environment: "production",
          platform: "web",
          importBridgeUrl: ONAIROS_IMPORT_BRIDGE_URL,
        });
        onairosInitializedRef.current = true;
        if (mounted) setOnairosSdkReady(true);
      } catch (e) {
        const rawMsg = e instanceof Error ? e.message : "Could not initialize Onairos.";
        const maybeCors = /network error|failed to fetch|cors|access-control-allow-origin/i.test(rawMsg);
        const msg = maybeCors
          ? "Onairos blocked this origin (CORS). Open this link on a deployed domain they allow."
          : rawMsg;
        if (mounted) setError(msg);
      } finally {
        if (mounted) setLoadingConnect(false);
      }
    }
    void bootOnairos();
    return () => {
      mounted = false;
    };
  }, [
    ONAIROS_API_KEY,
    ONAIROS_GOOGLE_CLIENT_ID,
    ONAIROS_IMPORT_BRIDGE_URL,
    error,
    resolvedPhone,
    resolving,
    isSocialReferrer,
  ]);

  useEffect(() => {
    if (!saved) return;
    const id = window.setTimeout(() => {
      if (!SMS_TARGET) {
        setShowSmsFallback(true);
        return;
      }
      const { showInAppFallback } = openSmsToInyo();
      if (showInAppFallback) setShowSmsFallback(true);
    }, 500);
    return () => window.clearTimeout(id);
  }, [saved]);

  const canRenderButton =
    !isSocialReferrer &&
    !resolving &&
    !error &&
    !saved &&
    Boolean(resolvedPhone) &&
    onairosSdkReady &&
    !!OnairosButtonComponent;

  async function handleOnairosComplete(result: unknown) {
    if (!token || saved) return;
    setSaving(true);
    setError(null);
    try {
      const completionPayload = extractOnairosCompletionPayload(result);
      const res = await fetch("/api/onairos/connect/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          onairosCompletion: completionPayload,
        }),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save Onairos connection.");
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save Onairos connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          filter: isSocialReferrer ? "blur(10px)" : "none",
          pointerEvents: isSocialReferrer ? "none" : "auto",
          userSelect: isSocialReferrer ? "none" : "auto",
          transition: "filter 0.2s ease",
        }}
        aria-hidden={isSocialReferrer}
      >
      <section
        style={{
          width: "100%",
          maxWidth: 620,
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 16,
          padding: 24,
          background: "#fff",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Connect Onairos</h1>
        <p style={{ marginBottom: 16, opacity: 0.72 }}>
          Connect your Onairos data to personalize your Inyo matching experience.
        </p>
        {resolvedPhone && (
          <p style={{ fontSize: 13, marginBottom: 12, opacity: 0.65 }}>
            Linked phone: <strong>{resolvedPhone}</strong>
          </p>
        )}
        {resolving && <p>Verifying link...</p>}
        {loadingConnect && !resolving && !error && <p>Preparing Onairos connection...</p>}
        {saving && <p>Saving your connection...</p>}
        {saved && (
          <div>
            <p style={{ color: "#0e9f6e", fontWeight: 600 }}>
              Done. Your Onairos connection is saved.
            </p>
            <p style={{ marginTop: 8 }}>
              Opening your SMS app so you can keep chatting with Inyo…
            </p>
            {showSmsFallback && SMS_TARGET && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 14, opacity: 0.85, marginBottom: 8 }}>
                  If Messages didn&apos;t open, tap below (some in-app browsers block automatic redirects).
                </p>
                <a
                  href={smsHrefToInyo()}
                  onClick={() => {
                    void openSmsToInyo();
                  }}
                  style={{
                    display: "inline-block",
                    padding: "10px 16px",
                    borderRadius: 10,
                    background: "#0e9f6e",
                    color: "#fff",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Open SMS app
                </a>
              </div>
            )}
            {!SMS_TARGET && (
              <p style={{ marginTop: 12, fontSize: 14, opacity: 0.8 }}>
                Set <code style={{ fontSize: 12 }}>NEXT_PUBLIC_INYO_SMS_TARGET</code> to enable automatic return to
                Messages.
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" style={{ color: "#c0392b", marginBottom: 12 }}>
            {error}
          </p>
        )}
        {canRenderButton && OnairosButtonComponent && (
          <OnairosButtonComponent
            webpageName="inyo"
            testMode={false}
            autoFetch={false}
            backgroundLoadData={true}
            preferencesMbti={true}
            requestData={{
              personality: { type: "personality", reward: "better compatibility signals" },
              preferences: { type: "preferences", reward: "stronger match quality" },
            }}
            allowedPlatforms={["tiktok"]}
            onComplete={handleOnairosComplete}
          />
        )}
        {!saved && (
          <div style={{ marginTop: 20 }}>
            <Link href="/">Back to Inyo</Link>
          </div>
        )}
      </section>
    </main>

      {isSocialReferrer && <SocialInAppBrowserModal />}
    </div>
  );
}

export default function OnairosConnectPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <p>Loading…</p>
        </main>
      }
    >
      <OnairosConnectInner />
    </Suspense>
  );
}
