import { v2 as cloudinary } from "cloudinary";

export const CLOUDINARY_ENV = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
] as const;

export function isCloudinaryConfigured(): boolean {
  return CLOUDINARY_ENV.every((k) => !!process.env[k]);
}

export function missingCloudinaryEnv(): string[] {
  return CLOUDINARY_ENV.filter((k) => !process.env[k]);
}

function ensureConfigured() {
  const m = missingCloudinaryEnv();
  if (m.length) {
    throw new Error(`Cloudinary is not configured (missing: ${m.join(", ")}).`);
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

type Resource = "image" | "video" | "raw" | "auto";

/** Upload a buffer to Cloudinary. Choose resource_type: image, video, raw (docs/audio/attachments), or auto. */
export async function uploadImageBuffer(
  buffer: Buffer,
  opts: { folder: string; publicId?: string; resourceType?: Resource } = { folder: "inyo/profiles" }
): Promise<{ secureUrl: string; publicId: string }> {
  ensureConfigured();
  const resource_type = opts.resourceType ?? "image";
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicId,
        resource_type,
        overwrite: true,
      },
      (err, result) => {
        if (err || !result) {
          reject(err ?? new Error("Cloudinary upload failed."));
          return;
        }
        resolve({ secureUrl: result.secure_url, publicId: result.public_id });
      }
    );
    stream.on("error", reject);
    stream.end(buffer);
  });
}

type DestroyResource = "image" | "video" | "raw";

/**
 * Best-effort delete of an uploaded asset (e.g. rollback when a later file in a batch fails).
 */
export async function destroyCloudinaryAsset(opts: { publicId: string; resourceType: DestroyResource }): Promise<void> {
  if (!opts.publicId?.trim()) return;
  ensureConfigured();
  await new Promise<void>((resolve, reject) => {
    cloudinary.uploader.destroy(
      opts.publicId,
      { resource_type: opts.resourceType, invalidate: true },
      (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        if (result?.result !== "ok" && result?.result !== "not found") {
          reject(new Error(String(result?.result ?? "delete failed")));
          return;
        }
        resolve();
      }
    );
  });
}
