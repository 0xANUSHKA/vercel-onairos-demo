"use client";

import { useMemo, useState } from "react";
import { OnairosButton } from "onairos";

export default function OnairosDemo() {
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!result) return "No result yet";
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }, [result]);

  return (
    <section style={{ maxWidth: 860, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Onairos + Next 16 (Vercel repro)</h1>
      <p>
        This component intentionally keeps all Onairos code in a client boundary.
        If build fails on Vercel, set <code>NEXT_DEBUG_BUILD_WORKER=0</code> and
        redeploy to reveal the underlying stack trace.
      </p>
      <div style={{ marginTop: 20, marginBottom: 16 }}>
        <OnairosButton
          webpageName={process.env.NEXT_PUBLIC_ONAIROS_WEBPAGE_NAME || "Vercel Repro"}
          requestData={["basicProfile", "preferences"]}
          onComplete={(payload) => {
            setError(null);
            setResult(payload);
          }}
        />
      </div>

      {error ? (
        <pre
          style={{
            background: "#1f0d14",
            color: "#ffd6df",
            borderRadius: 8,
            padding: 12,
            overflowX: "auto",
          }}
        >
          {error}
        </pre>
      ) : null}

      <h2 style={{ marginTop: 20 }}>Latest payload</h2>
      <pre
        style={{
          background: "#0f172a",
          color: "#dbeafe",
          borderRadius: 8,
          padding: 12,
          overflowX: "auto",
        }}
      >
        {preview}
      </pre>
    </section>
  );
}
