function resolveLandingOriginBase(): string | null {
  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return origin;
    }
  }
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    const raw = explicit.replace(/\/$/, "");
    return raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return null;
}

/** Homepage only — use for “Open in browser” / copy so Safari/Chrome does not re-trigger the social modal. */
export function joininyoLandingCleanUrl(): string {
  const base = resolveLandingOriginBase();
  if (base) {
    const u = new URL("/", base);
    return u.toString();
  }
  return "https://joininyo.com/";
}

/**
 * Marketing / in-app entry URL with ?referer=social (e.g. links pasted in Instagram).
 * Same origin rules as clean URL, plus the social flag.
 */
export function joininyoLandingSocialUrl(): string {
  const base = resolveLandingOriginBase();
  if (base) {
    const u = new URL("/", base);
    u.searchParams.set("referer", "social");
    return u.toString();
  }
  return "https://joininyo.com/?referer=social";
}

/** iOS in-app WebViews often hand off to Safari with this scheme (https URLs only). */
export function iosSafariHandoffUrlFromHttps(httpsUrl: string): string {
  try {
    const u = new URL(httpsUrl);
    if (u.protocol !== "https:") return httpsUrl;
    return `x-safari-https://${u.host}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return httpsUrl;
  }
}

export function externalBrowserHandoffUrl(url: string): string {
  if (typeof navigator === "undefined") return url;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return iosSafariHandoffUrlFromHttps(url);
  }
  return url;
}
