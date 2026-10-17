"use server";

import { cookies } from "next/headers";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DEFAULT_PUBLIC_CONFIG, PublicSiteConfig } from "@/lib/types";
import {
  PUBLIC_CONFIG_KEY,
  PUBLIC_ALBUMS_KEY,
  getPublicSiteConfig,
  savePublicSiteConfigToR2,
} from "@/lib/r2";

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


// ---------------------------------------------------------------------------
// Upload pipeline (ported from the original site, retargeted to albums_public.json)
// ---------------------------------------------------------------------------
const BUCKET_NAME = process.env.R2_BUCKET_NAME || "";

export async function getDirectUploadUrl(
  key: string,
  contentType: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Admin session expired. Please log in again." };

    if (!BUCKET_NAME) return { success: false, error: "R2_BUCKET_NAME is not set in Vercel." };

    const r2 = getR2WriteClient();
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(r2, command, { expiresIn: 3600 });

    // Validate generated signed URL
    try {
      new URL(url);
    } catch {
      return { success: false, error: `Generated signed URL is invalid: "${url}"` };
    }

    return { success: true, url };
  } catch (err: any) {
    return { success: false, error: `getDirectUploadUrl error: ${err?.message || String(err)}` };
  }
}

export async function createAlbum(albumData: {
  album_id: string;
  title: string;
  date: string;
  category?: string;
  photos: any[];
  cover_url: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Admin session expired. Please log in again." };

    const r2 = getR2WriteClient();

    // 1. Save album manifest
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${albumData.album_id}/manifest.json`,
        Body: JSON.stringify(albumData, null, 2),
        ContentType: "application/json",
      })
    );

    // 2. Update global albums index
    const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.replace(/\/$/, "");
    let albums: any[] = [];
    if (baseUrl) {
      try {
        const res = await fetch(`${baseUrl}/albums_public.json`, { cache: "no-store" });
        if (res.ok) albums = await res.json();
      } catch {
        albums = [];
      }
    }

    const newSummary = {
      id: albumData.album_id,
      title: albumData.title,
      date: albumData.date,
      category: albumData.category || "School Sports",
      photo_count: albumData.photos.length,
      cover_url: albumData.cover_url,
    };

    const updatedAlbums = [newSummary, ...albums.filter((a) => a.id !== albumData.album_id)];

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: "albums_public.json",
        Body: JSON.stringify(updatedAlbums, null, 2),
        ContentType: "application/json",
      })
    );

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function updateExistingAlbum(albumData: {
  album_id: string;
  title: string;
  date: string;
  category?: string;
  photos: any[];
  cover_url: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Admin session expired." };

    const r2 = getR2WriteClient();

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${albumData.album_id}/manifest.json`,
        Body: JSON.stringify(albumData, null, 2),
        ContentType: "application/json",
      })
    );

    const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.trim().replace(/\/$/, "");
    let albums: any[] = [];
    if (baseUrl && baseUrl.startsWith("http")) {
      try {
        const res = await fetch(`${baseUrl}/albums_public.json`, { cache: "no-store" });
        if (res.ok) albums = await res.json();
      } catch {
        albums = [];
      }
    }

    const updatedAlbums = albums.map((a) => {
      if (a.id === albumData.album_id) {
        return {
          ...a,
          title: albumData.title,
          date: albumData.date,
          category: albumData.category || "School Sports",
          photo_count: albumData.photos.length,
          cover_url: albumData.cover_url,
        };
      }
      return a;
    });

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: "albums_public.json",
        Body: JSON.stringify(updatedAlbums, null, 2),
        ContentType: "application/json",
      })
    );

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function deletePhotoFromR2(keys: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Unauthorized" };
    if (keys.length === 0) return { success: true };

    const r2 = getR2WriteClient();
    await r2.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function deleteAlbum(albumId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Unauthorized" };

    if (!BUCKET_NAME) return { success: false, error: "R2_BUCKET_NAME is not set." };

    const r2 = getR2WriteClient();

    // 1. Fetch current albums_public.json
    let albums: any[] = [];
    try {
      const indexObj = await r2.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: "albums_public.json",
        })
      );
      const str = await indexObj.Body?.transformToString();
      if (str) albums = JSON.parse(str);
    } catch {
      // albums_public.json may be missing or empty
    }

    // 2. Filter out the deleted album
    const updatedAlbums = albums.filter((a: any) => a.id !== albumId);

    // 3. Save updated albums_public.json back to R2
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: "albums_public.json",
        Body: JSON.stringify(updatedAlbums, null, 2),
        ContentType: "application/json",
      })
    );

    // 4. Delete the album's manifest.json
    try {
      await r2.send(
        new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `${albumId}/manifest.json`,
        })
      );
    } catch (e) {
      console.warn("Could not delete manifest.json:", e);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Import albums from the family site (shared bucket, separate album indexes)
// ---------------------------------------------------------------------------

/**
 * Import family-site albums into this site's index by album id.
 * Photo files are shared (identical R2 keys); only the album listing is copied.
 * Dedups by id, so re-importing is safe. Imported entries keep the family
 * index's newest-first order. Any imported album whose category is not in the
 * public config's visible_categories gets its category auto-added so the
 * imported albums actually appear on the public site.
 */
export async function importAlbumsFromFamily(
  albumIds: string[]
): Promise<{ success: boolean; imported?: number; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Unauthorized" };

    const bucket = process.env.R2_BUCKET_NAME?.trim();
    if (!bucket) return { success: false, error: "R2_BUCKET_NAME is not set." };

    const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.trim().replace(/\/$/, "");
    if (!baseUrl) return { success: false, error: "NEXT_PUBLIC_R2_BASE_URL is not set." };

    const wanted = new Set((albumIds || []).map((id) => String(id)));
    if (wanted.size === 0) return { success: true, imported: 0 };

    // 1. Family index (public read)
    let familyAlbums: any[] = [];
    try {
      const res = await fetch(`${baseUrl}/albums.json`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) familyAlbums = data;
      }
    } catch {
      // fall through to empty — handled below
    }

    const r2 = getR2WriteClient();

    // 2. Current public index (via R2, like deleteAlbum)
    let publicAlbums: any[] = [];
    try {
      const indexObj = await r2.send(
        new GetObjectCommand({ Bucket: bucket, Key: PUBLIC_ALBUMS_KEY })
      );
      const str = await indexObj.Body?.transformToString();
      if (str) {
        const data = JSON.parse(str);
        if (Array.isArray(data)) publicAlbums = data;
      }
    } catch {
      // albums_public.json may be missing — start fresh
    }

    // Keep family-index order (newest first); skip anything already present
    const existingIds = new Set(publicAlbums.map((a) => String(a?.id)));
    const toImport = familyAlbums.filter(
      (a) => a && wanted.has(String(a.id)) && !existingIds.has(String(a.id))
    );

    if (toImport.length > 0) {
      await r2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: PUBLIC_ALBUMS_KEY,
          Body: JSON.stringify([...toImport, ...publicAlbums], null, 2),
          ContentType: "application/json",
        })
      );
    }

    // 3. Auto-add new categories to visible_categories so imports actually appear
    const config = await getPublicSiteConfig();
    const visibleLower = new Set(
      config.visible_categories.map((c) => c.toLowerCase().trim())
    );
    let categoriesAdded = false;
    for (const a of toImport) {
      const cat = String(a.category || "").trim();
      if (cat && !visibleLower.has(cat.toLowerCase())) {
        config.visible_categories.push(cat);
        visibleLower.add(cat.toLowerCase());
        categoriesAdded = true;
      }
    }
    if (categoriesAdded) {
      await savePublicSiteConfigToR2(config);
    }

    return { success: true, imported: toImport.length };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}
