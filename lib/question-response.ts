/**
 * Onboarding `questions.response_type` and `onboarding_answers.response_text`.
 * Non-TEXT answers are JSON: { "files": [ { "url": "https://..." }, ... ] }
 * (Legacy `PHOTOS_4` / { "photo_urls": [...] } is still accepted when reading.)
 */

export const RESPONSE_TYPE_TEXT = "TEXT" as const;
export const RESPONSE_TYPE_IMAGE = "IMAGE" as const;
export const RESPONSE_TYPE_AUDIO = "AUDIO" as const;
export const RESPONSE_TYPE_VIDEO = "VIDEO" as const;
export const RESPONSE_TYPE_FILE = "FILE" as const;

export type ResponseType =
  | typeof RESPONSE_TYPE_TEXT
  | typeof RESPONSE_TYPE_IMAGE
  | typeof RESPONSE_TYPE_AUDIO
  | typeof RESPONSE_TYPE_VIDEO
  | typeof RESPONSE_TYPE_FILE;

export type FileResponseType = Exclude<ResponseType, typeof RESPONSE_TYPE_TEXT>;

export const ALL_RESPONSE_TYPES: ResponseType[] = [
  RESPONSE_TYPE_TEXT,
  RESPONSE_TYPE_IMAGE,
  RESPONSE_TYPE_AUDIO,
  RESPONSE_TYPE_VIDEO,
  RESPONSE_TYPE_FILE,
];

/** Legacy value from earlier schema — treat like IMAGE. */
const LEGACY_PHOTOS_4 = "PHOTOS_4";

export function isResponseType(s: string | null | undefined): s is ResponseType {
  return ALL_RESPONSE_TYPES.includes(s as ResponseType);
}

export function isFileLikeResponseType(s: string | null | undefined): boolean {
  if (s == null || s === "") return false;
  if (s === LEGACY_PHOTOS_4) return true;
  if (s === RESPONSE_TYPE_TEXT) return false;
  const fileKinds: FileResponseType[] = [
    RESPONSE_TYPE_IMAGE,
    RESPONSE_TYPE_AUDIO,
    RESPONSE_TYPE_VIDEO,
    RESPONSE_TYPE_FILE,
  ];
  return fileKinds.includes(s as FileResponseType);
}

export function defaultResponseType(s: string | null | undefined): ResponseType {
  if (s === LEGACY_PHOTOS_4 || s === RESPONSE_TYPE_IMAGE) return RESPONSE_TYPE_IMAGE;
  if (s === RESPONSE_TYPE_TEXT) return RESPONSE_TYPE_TEXT;
  if (s === RESPONSE_TYPE_AUDIO) return RESPONSE_TYPE_AUDIO;
  if (s === RESPONSE_TYPE_VIDEO) return RESPONSE_TYPE_VIDEO;
  if (s === RESPONSE_TYPE_FILE) return RESPONSE_TYPE_FILE;
  return RESPONSE_TYPE_TEXT;
}

export type FileAnswerItem = { url: string };
export type FileAnswerPayload = { files: FileAnswerItem[] };

/**
 * Parse stored answer — supports { files: [...] } and legacy { photo_urls: [...] }.
 */
export function parseFileAnswerJson(text: string): FileAnswerPayload | null {
  const t = String(text ?? "").trim();
  if (!t.startsWith("{")) return null;
  try {
    const o = JSON.parse(t) as { files?: unknown; photo_urls?: unknown };
    if (Array.isArray(o.files)) {
      return {
        files: o.files.map((item) => {
          if (typeof item === "string") return { url: item };
          if (item && typeof item === "object" && "url" in item) {
            return { url: String((item as { url: string }).url ?? "") };
          }
          return { url: "" };
        }),
      };
    }
    if (Array.isArray(o.photo_urls)) {
      return { files: o.photo_urls.map((u) => ({ url: String(u ?? "") })) };
    }
  } catch {
    return null;
  }
  return null;
}

export function stringifyFileAnswer(files: FileAnswerItem[]): string {
  const cleaned = files
    .map((f) => (typeof f?.url === "string" ? f.url.trim() : ""))
    .filter((u) => u.length > 0)
    .map((url) => ({ url }));
  return JSON.stringify({ files: cleaned });
}

const URLish = (u: string) => u.startsWith("https://") || u.startsWith("http://");

/** Valid http(s) URLs in a stored file-answer JSON (order preserved, deduped). */
export function fileUrlsFromAnswerString(text: string | null | undefined): string[] {
  const p = parseFileAnswerJson(String(text ?? ""));
  if (!p) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of p.files) {
    const u = String(f?.url ?? "").trim();
    if (!URLish(u) || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

export function countFileUrlsInAnswerString(text: string | null | undefined): number {
  return fileUrlsFromAnswerString(text).length;
}

/**
 * Merge new inbound file JSON into an existing answer (same question), deduping URLs.
 * Use this so users can send multiple MMS batches before meeting min_file_count.
 */
export function mergeFileAnswerStrings(
  existing: string | null | undefined,
  newBlock: string | null
): string {
  const a = fileUrlsFromAnswerString(existing);
  const b = fileUrlsFromAnswerString(newBlock);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of [...a, ...b]) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return stringifyFileAnswer(out.map((url) => ({ url })));
}

export function isValidFileMediaAnswerString(text: string | null | undefined): boolean {
  const p = parseFileAnswerJson(String(text ?? ""));
  if (!p || p.files.length === 0) return false;
  return p.files.some((f) => URLish((f.url ?? "").trim()));
}

/**
 * For TEXT, non-empty trim. For any file-like type, at least one valid file URL in JSON.
 */
export function isNonEmptyAnswerForType(
  responseText: string,
  responseType: ResponseType | string | null | undefined
): boolean {
  const t = defaultResponseType(String(responseType));
  if (t === RESPONSE_TYPE_TEXT) {
    return String(responseText ?? "").trim().length > 0;
  }
  return isValidFileMediaAnswerString(responseText);
}

export function labelForResponseType(t: ResponseType | string): string {
  switch (String(t)) {
    case RESPONSE_TYPE_TEXT:
      return "Text";
    case LEGACY_PHOTOS_4:
    case RESPONSE_TYPE_IMAGE:
      return "Image(s)";
    case RESPONSE_TYPE_AUDIO:
      return "Audio";
    case RESPONSE_TYPE_VIDEO:
      return "Video";
    case RESPONSE_TYPE_FILE:
      return "File(s)";
    default:
      return "Text";
  }
}
