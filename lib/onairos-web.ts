type OnairosNs = typeof import("onairos");

type OnairosResolved = {
  initializeApiKey: OnairosNs["initializeApiKey"] | undefined;
  OnairosButton: OnairosNs["OnairosButton"];
};

let cached: OnairosResolved | null = null;

function defaultExportBag(ns: OnairosNs): Partial<OnairosNs> | null {
  const d = ns.default as unknown;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    return d as Partial<OnairosNs>;
  }
  return null;
}

export async function loadOnairosSdk(): Promise<OnairosResolved> {
  if (cached) return cached;

  const ns = (await import("onairos")) as OnairosNs;
  const fromDefault = defaultExportBag(ns);

  const initializeApiKey: OnairosNs["initializeApiKey"] | undefined =
    typeof ns.initializeApiKey === "function"
      ? ns.initializeApiKey
      : fromDefault && typeof fromDefault.initializeApiKey === "function"
        ? fromDefault.initializeApiKey
        : undefined;

  const rawButton = ns.OnairosButton ?? fromDefault?.OnairosButton;
  if (!rawButton || typeof rawButton !== "function") {
    throw new Error('Onairos: missing OnairosButton export. Reinstall the "onairos" package.');
  }

  cached = {
    initializeApiKey,
    OnairosButton: rawButton as OnairosNs["OnairosButton"],
  };
  return cached;
}

const PLACEHOLDER_KEY = "{Your_API_Key}";

/** Call before `initializeApiKey` so local dev fails fast with a clear message. */
export function assertOnairosApiKeyForInit(apiKey: string): void {
  const t = apiKey.trim();
  if (!t || t === PLACEHOLDER_KEY) {
    throw new Error(
      "Set NEXT_PUBLIC_ONAIROS_API_KEY in .env to your real Onairos API key (from the dev board). " +
        `The placeholder "${PLACEHOLDER_KEY}" cannot initialize the SDK.`,
    );
  }
}
