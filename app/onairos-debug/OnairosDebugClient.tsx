"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";

type OnairosButtonProps = {
  webpageName: string;
  requestData: Record<string, { type: string; reward: string }>;
  autoFetch?: boolean;
  backgroundLoadData?: boolean;
  preferencesMbti?: boolean;
  testMode?: boolean;
  onComplete?: (result: unknown) => void;
};

type OnairosModule = {
  initializeApiKey?: (config: {
    apiKey: string;
    environment?: string;
    enableLogging?: boolean;
    platform?: string;
  }) => Promise<unknown>;
  OnairosButton?: ComponentType<OnairosButtonProps>;
  default?: Partial<OnairosModule>;
};

const API_KEY =
  process.env.NEXT_PUBLIC_ONAIROS_API_KEY ??
  "dev_d1dddadfc599b49ff019527b3bd5a1323e1417828c64310cb6fe3cac613899e8";

export default function OnairosDebugClient() {
  const [Button, setButton] = useState<ComponentType<OnairosButtonProps> | null>(null);
  const [status, setStatus] = useState("Loading Onairos SDK...");
  const [result, setResult] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!API_KEY.trim()) {
          setStatus("Missing NEXT_PUBLIC_ONAIROS_API_KEY.");
          return;
        }

        window.localStorage.setItem("onairos_api_key", API_KEY);
        (window as typeof window & { onairosApiKey?: string }).onairosApiKey = API_KEY;

        const mod = (await import("onairos")) as OnairosModule;
        const fallback = mod.default && typeof mod.default === "object" ? mod.default : {};
        const initializeApiKey = mod.initializeApiKey ?? fallback.initializeApiKey;
        const OnairosButton = mod.OnairosButton ?? fallback.OnairosButton;

        if (!OnairosButton) throw new Error("OnairosButton export was not found.");

        if (initializeApiKey) {
          await initializeApiKey({
            apiKey: API_KEY,
            environment: "production",
            enableLogging: true,
            platform: "web",
          });
        }

        if (!cancelled) {
          setButton(() => OnairosButton);
          setStatus("Onairos SDK ready.");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(err instanceof Error ? err.message : "Failed to load Onairos SDK.");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = useMemo(() => {
    if (!result) return "No result yet";
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }, [result]);

  return (
    <main style={{ minHeight: "100vh", padding: 32, background: "#050505", color: "#f7f7f7" }}>
      <section style={{ maxWidth: 760 }}>
        <h1 style={{ fontSize: 36, marginBottom: 8 }}>Inyo Onairos Debug</h1>
        <p style={{ opacity: 0.8, marginBottom: 20 }}>{status}</p>

        {Button ? (
          <Button
            webpageName="inyo"
            testMode={false}
            autoFetch={false}
            backgroundLoadData={true}
            preferencesMbti={true}
            requestData={{
              personality: { type: "personality", reward: "better compatibility signals" },
              preferences: { type: "preferences", reward: "stronger match quality" },
            }}
            onComplete={setResult}
          />
        ) : (
          <button
            type="button"
            disabled
            style={{
              opacity: 0.6,
              padding: "10px 16px",
              borderRadius: 999,
              border: "1px solid #555",
              background: "#191919",
              color: "#fff",
            }}
          >
            Connect Data
          </button>
        )}

        <h2 style={{ marginTop: 28 }}>Latest payload</h2>
        <pre style={{ padding: 16, borderRadius: 12, background: "#101827", overflowX: "auto" }}>
          {preview}
        </pre>
      </section>
    </main>
  );
}
