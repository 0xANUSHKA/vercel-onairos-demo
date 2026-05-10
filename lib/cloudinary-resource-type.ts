import {
  RESPONSE_TYPE_IMAGE,
  RESPONSE_TYPE_VIDEO,
} from "@/lib/question-response";

export type CloudinaryResource = "image" | "video" | "raw";

/**
 * Same mapping as `upload-asset` / `uploadImageBuffer` (IMAGE→image, VIDEO→video, else raw).
 */
export function responseTypeToCloudinaryResource(expected: string): CloudinaryResource {
  const e = String(expected).toUpperCase();
  if (e === RESPONSE_TYPE_IMAGE) return "image";
  if (e === RESPONSE_TYPE_VIDEO) return "video";
  return "raw";
}
