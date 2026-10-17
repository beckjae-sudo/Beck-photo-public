"use server";

import { cookies } from "next/headers";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  DEFAULT_PUBLIC_CONFIG,
  PublicSiteConfig,
} from "@/lib/types";
import { PUBLIC_CONFIG_KEY, getPublicSiteConfig, getAllAlbumCategories } from "@/lib/r2";

/** Config + discovered categories for the admin editor. Auth required. */
export async function getAdminData(): Promise<{
  success: boolean;
  config?: PublicSiteConfig;
  allCategories?: string[];
  error?: string;
}> {
  const isAuth = await checkAdminAuth();
  if (!isAuth) return { success: false, error: "Unauthorized" };
  try {
    const [config, allCategories] = await Promise.all([
      getPublicSiteConfig(),
      getAllAlbumCategories(),
    ]);
    return { success: true, config, allCategories };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

export async function checkAdminAuth(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get("admin_session")?.value === "authenticated";
  } catch {
    return false;
  }
}

export async function loginAdmin(
  password: string
): Promise<{ success: boolean }> {
  try {
    if (password === ADMIN_PASSWORD) {
      const cookieStore = await cookies();
      cookieStore.set("admin_session", "authenticated", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
      });
      return { success: true };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

export async function logoutAdmin(): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete("admin_session");
  } catch {
    // noop
  }
}

function getR2WriteClient(): S3Client {
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 write env vars (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)."
    );
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

function sanitizeConfig(raw: unknown): PublicSiteConfig {
  const r = (raw || {}) as Partial<PublicSiteConfig>;
  const visible = Array.isArray(r.visible_categories)
    ? r.visible_categories
        .map((c) => String(c).trim())
        .filter((c) => c.length > 0)
    : [];
  const latest =
    typeof r.latest_count === "number" && r.latest_count > 0
      ? Math.min(50, Math.floor(r.latest_count))
      : DEFAULT_PUBLIC_CONFIG.latest_count;
  return {
    site_title: String(r.site_title || DEFAULT_PUBLIC_CONFIG.site_title),
    badge_text: String(r.badge_text || DEFAULT_PUBLIC_CONFIG.badge_text),
    hero_headline: String(
      r.hero_headline || DEFAULT_PUBLIC_CONFIG.hero_headline
    ),
    hero_description: String(
      r.hero_description || DEFAULT_PUBLIC_CONFIG.hero_description
    ),
    theme_preset: String(r.theme_preset || DEFAULT_PUBLIC_CONFIG.theme_preset),
    visible_categories: visible,
    latest_count: latest,
  };
}

export async function savePublicSiteConfig(
  rawConfig: unknown
): Promise<{ success: boolean; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Unauthorized" };

    const bucket = process.env.R2_BUCKET_NAME?.trim();
    if (!bucket) return { success: false, error: "R2_BUCKET_NAME is not set." };

    const config = sanitizeConfig(rawConfig);
    const r2 = getR2WriteClient();
    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: PUBLIC_CONFIG_KEY,
        Body: JSON.stringify(config, null, 2),
        ContentType: "application/json",
      })
    );
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
