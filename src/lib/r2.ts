import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  AlbumSummary,
  DEFAULT_PUBLIC_CONFIG,
  PublicSiteConfig,
  isAlbumVisible,
} from "./types";

export const PUBLIC_CONFIG_KEY = "site_config_public.json";
/** This site's own album index in the shared bucket. The family site uses albums.json. */
export const PUBLIC_ALBUMS_KEY = "albums_public.json";

/** Public base URL of the shared R2 bucket (e.g. https://pub-....r2.dev). */
export function getPublicBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_R2_BASE_URL || "").replace(/\/$/, "");
}

/** Fetch the public site config from the shared bucket. Falls back to safe defaults. */
export async function getPublicSiteConfig(): Promise<PublicSiteConfig> {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return DEFAULT_PUBLIC_CONFIG;
  try {
    const res = await fetch(`${baseUrl}/${PUBLIC_CONFIG_KEY}`, {
      cache: "no-store",
    });
    if (!res.ok) return DEFAULT_PUBLIC_CONFIG;
    const raw = await res.json();
    return {
      ...DEFAULT_PUBLIC_CONFIG,
      ...raw,
      visible_categories: Array.isArray(raw?.visible_categories)
        ? raw.visible_categories
        : DEFAULT_PUBLIC_CONFIG.visible_categories,
      latest_count:
        typeof raw?.latest_count === "number" && raw.latest_count > 0
          ? Math.floor(raw.latest_count)
          : DEFAULT_PUBLIC_CONFIG.latest_count,
    };
  } catch {
    return DEFAULT_PUBLIC_CONFIG;
  }
}

/** Fetch this site's album index (newest first), filtered to public-visible categories. */
export async function getVisibleAlbums(): Promise<AlbumSummary[]> {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return [];
  const config = await getPublicSiteConfig();
  try {
    const res = await fetch(`${baseUrl}/${PUBLIC_ALBUMS_KEY}`, { cache: "no-store" });
    if (!res.ok) return [];
    const albums: AlbumSummary[] = await res.json();
    if (!Array.isArray(albums)) return [];
    return albums.filter((a) =>
      isAlbumVisible(a, config.visible_categories)
    );
  } catch {
    return [];
  }
}

/** All distinct categories present in this site's album index (for the admin picker). */
export async function getAllAlbumCategories(): Promise<string[]> {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return [];
  try {
    const res = await fetch(`${baseUrl}/${PUBLIC_ALBUMS_KEY}`, { cache: "no-store" });
    if (!res.ok) return [];
    const albums: AlbumSummary[] = await res.json();
    const set = new Set<string>();
    for (const a of albums) {
      if (a.category && a.category.trim()) set.add(a.category.trim());
    }
    return Array.from(set).sort((x, y) => x.localeCompare(y));
  } catch {
    return [];
  }
}

/* ---------------- Server-side R2 writer (admin only) ---------------- */

function getR2WriteClient(): S3Client {
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 write env vars (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).");
  }
  try {
    new URL(endpoint);
  } catch {
    throw new Error(`R2_ENDPOINT is not a valid URL: "${endpoint}"`);
  }
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

/** Persist the public site config to the shared bucket. Admin-only callers. */
export async function savePublicSiteConfigToR2(
  config: PublicSiteConfig
): Promise<void> {
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!bucket) throw new Error("R2_BUCKET_NAME is not set.");
  const r2 = getR2WriteClient();
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: PUBLIC_CONFIG_KEY,
      Body: JSON.stringify(config, null, 2),
      ContentType: "application/json",
    })
  );
}
