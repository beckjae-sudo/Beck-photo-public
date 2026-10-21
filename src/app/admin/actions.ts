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
import { DEFAULT_PUBLIC_CONFIG, PublicSiteConfig, clampBrightness, sanitizeRosters, sanitizeTeamDescriptions } from "@/lib/types";
import { validFontKey } from "@/lib/fonts";
import { playerKeyFor, rosterForCategory } from "@/lib/players";
import {
  readTagsFile,
  writeTagsFile,
  tagSource,
  AutoTagRunSummary,
} from "@/lib/tagsStore";
import {
  PUBLIC_CONFIG_KEY,
  PUBLIC_ALBUMS_KEY,
  dedupeCategories,
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
    categories: dedupeCategories(r.categories),
    splash_brightness: clampBrightness(
      r.splash_brightness,
      DEFAULT_PUBLIC_CONFIG.splash_brightness
    ),
    mosaic_brightness: clampBrightness(
      r.mosaic_brightness,
      DEFAULT_PUBLIC_CONFIG.mosaic_brightness
    ),
    album_backdrop_brightness: clampBrightness(
      r.album_backdrop_brightness,
      DEFAULT_PUBLIC_CONFIG.album_backdrop_brightness
    ),
    font_brand: validFontKey(r.font_brand),
    font_badge: validFontKey(r.font_badge),
    font_headline: validFontKey(r.font_headline),
    font_description: validFontKey(r.font_description),
    font_ui: validFontKey(r.font_ui),
    rosters: sanitizeRosters(r.rosters),
    team_descriptions: sanitizeTeamDescriptions(r.team_descriptions),
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
// Category manager (canonical `categories` list + propagation to albums)
// ---------------------------------------------------------------------------

/** Read this site's album index via R2. Returns [] when missing/unreadable. */
async function readPublicAlbumsIndex(r2: S3Client, bucket: string): Promise<any[]> {
  try {
    const indexObj = await r2.send(
      new GetObjectCommand({ Bucket: bucket, Key: PUBLIC_ALBUMS_KEY })
    );
    const str = await indexObj.Body?.transformToString();
    if (str) {
      const data = JSON.parse(str);
      if (Array.isArray(data)) return data;
    }
  } catch {
    // albums_public.json may be missing or empty
  }
  return [];
}

async function writePublicAlbumsIndex(
  r2: S3Client,
  bucket: string,
  albums: any[]
): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: PUBLIC_ALBUMS_KEY,
      Body: JSON.stringify(albums, null, 2),
      ContentType: "application/json",
    })
  );
}

/** Replace every list entry matching `oldName` (case-insensitive, trimmed)
 *  with `newName`, preserving position. */
function replaceCategoryInList(list: string[], oldName: string, newName: string): string[] {
  const key = oldName.trim().toLowerCase();
  return list.map((c) => (c.trim().toLowerCase() === key ? newName : c));
}

/**
 * Rename a category everywhere: the canonical `categories` list,
 * `visible_categories`, and every album in albums_public.json whose
 * category matches (case-insensitive). Names are trimmed; the rename is
 * rejected when empty or when it would collide with another existing
 * category (case-insensitive).
 */
export async function renameCategory(
  oldName: string,
  newName: string
): Promise<{ success: boolean; renamedAlbums?: number; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Unauthorized" };

    const bucket = process.env.R2_BUCKET_NAME?.trim();
    if (!bucket) return { success: false, error: "R2_BUCKET_NAME is not set." };

    const from = String(oldName || "").trim();
    const to = String(newName || "").trim();
    if (!from) return { success: false, error: "Pick a category to rename." };
    if (!to) return { success: false, error: "The new name can't be empty." };
    if (from.toLowerCase() === to.toLowerCase())
      return { success: false, error: "The new name is the same as the old one." };

    const config = await getPublicSiteConfig();
    const known = new Set(config.categories.map((c) => c.trim().toLowerCase()));
    if (!known.has(from.toLowerCase()))
      return { success: false, error: `"${from}" isn't in the category list.` };
    if (known.has(to.toLowerCase()))
      return { success: false, error: `"${to}" already exists as a category.` };

    const r2 = getR2WriteClient();
    const albums = await readPublicAlbumsIndex(r2, bucket);
    let renamedAlbums = 0;
    const updatedAlbums = albums.map((a) => {
      if (a && String(a.category || "").trim().toLowerCase() === from.toLowerCase()) {
        renamedAlbums += 1;
        return { ...a, category: to };
      }
      return a;
    });

    config.categories = replaceCategoryInList(config.categories, from, to);
    config.visible_categories = replaceCategoryInList(config.visible_categories, from, to);
    // Rosters are keyed by category name — move the roster along so a
    // rename doesn't orphan the team's player list (Phase 1).
    const rosterFromKey = Object.keys(config.rosters || {}).find(
      (k) => k.trim().toLowerCase() === from.toLowerCase()
    );
    if (rosterFromKey) {
      config.rosters = { ...config.rosters, [to]: config.rosters[rosterFromKey] };
      if (rosterFromKey !== to) delete config.rosters[rosterFromKey];
    }
    // Team look descriptions are keyed by category too — carry them along.
    const descFromKey = Object.keys(config.team_descriptions || {}).find(
      (k) => k.trim().toLowerCase() === from.toLowerCase()
    );
    if (descFromKey) {
      config.team_descriptions = {
        ...config.team_descriptions,
        [to]: config.team_descriptions[descFromKey],
      };
      if (descFromKey !== to) delete config.team_descriptions[descFromKey];
    }

    await writePublicAlbumsIndex(r2, bucket, updatedAlbums);
    await savePublicSiteConfigToR2(config);

    return { success: true, renamedAlbums };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Delete a category from the canonical list and `visible_categories`.
 * Only allowed when no album in albums_public.json uses it
 * (case-insensitive); otherwise the admin must rename or recategorize first.
 */
export async function deleteCategory(
  name: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Unauthorized" };

    const bucket = process.env.R2_BUCKET_NAME?.trim();
    if (!bucket) return { success: false, error: "R2_BUCKET_NAME is not set." };

    const target = String(name || "").trim();
    if (!target) return { success: false, error: "Pick a category to delete." };

    const r2 = getR2WriteClient();
    const albums = await readPublicAlbumsIndex(r2, bucket);
    const inUse = albums.some(
      (a) => a && String(a.category || "").trim().toLowerCase() === target.toLowerCase()
    );
    if (inUse)
      return {
        success: false,
        error: `"${target}" is used by albums — rename it or move those albums first.`,
      };

    const config = await getPublicSiteConfig();
    const key = target.toLowerCase();
    config.categories = config.categories.filter((c) => c.trim().toLowerCase() !== key);
    config.visible_categories = config.visible_categories.filter(
      (c) => c.trim().toLowerCase() !== key
    );
    await savePublicSiteConfigToR2(config);

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

/**
 * Fail-closed category check for album create/edit: the submitted category
 * must be one of the site's canonical categories (site_config_public.json).
 * Returns the canonical-cased category name on success.
 */
async function validateAlbumCategory(
  category?: string
): Promise<{ ok: true; category: string } | { ok: false; error: string }> {
  const submitted = String(category || "").trim();
  if (!submitted) {
    return {
      ok: false,
      error:
        "No category was chosen for this album. Pick one of the site's categories — an album can't be saved without one.",
    };
  }
  const config = await getPublicSiteConfig();
  const match = config.categories.find(
    (c) => c.trim().toLowerCase() === submitted.toLowerCase()
  );
  if (!match) {
    return {
      ok: false,
      error: `"${submitted}" isn't one of the site's categories, so this album would be hidden from the public site. Pick a category from the site's category list instead.`,
    };
  }
  return { ok: true, category: match };
}

function normalizeTeamLook(value?: string): string {
  return String(value || "").trim().slice(0, 200);
}

export async function createAlbum(albumData: {
  album_id: string;
  title: string;
  date: string;
  category?: string;
  teamLook?: string;
  photos: any[];
  cover_url: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Admin session expired. Please log in again." };

    const categoryCheck = await validateAlbumCategory(albumData.category);
    if (!categoryCheck.ok) return { success: false, error: categoryCheck.error };
    const category = categoryCheck.category;
    const teamLook = normalizeTeamLook(albumData.teamLook);

    const r2 = getR2WriteClient();

    // 1. Save album manifest
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${albumData.album_id}/manifest.json`,
        Body: JSON.stringify({ ...albumData, category, teamLook }, null, 2),
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
      category,
      teamLook,
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
  teamLook?: string;
  photos: any[];
  cover_url: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, error: "Admin session expired." };

    const categoryCheck = await validateAlbumCategory(albumData.category);
    if (!categoryCheck.ok) return { success: false, error: categoryCheck.error };
    const category = categoryCheck.category;
    const teamLook = normalizeTeamLook(albumData.teamLook);

    const r2 = getR2WriteClient();

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${albumData.album_id}/manifest.json`,
        Body: JSON.stringify({ ...albumData, category, teamLook }, null, 2),
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
          category,
          teamLook,
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
 * index's newest-first order.
 *
 * Fail-closed on visibility: importing NEVER changes which categories are
 * public. If an imported album's category is not in visible_categories, the
 * album stays hidden on the public site and its category is reported back in
 * `hiddenCategories` so the admin UI can say so — making it public is a
 * separate, deliberate step in Site Design & Categories.
 */
export async function importAlbumsFromFamily(
  albumIds: string[]
): Promise<{
  success: boolean;
  imported?: number;
  hiddenCategories?: string[];
  error?: string;
}> {
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

    // 3. Report (never fix) visibility: importing must not make a category
    //    public as a side effect. Any imported album whose category is not
    //    currently visible stays hidden; name those categories so the admin
    //    UI can tell the maintainer exactly what won't appear and why.
    const config = await getPublicSiteConfig();
    const visibleLower = new Set(
      config.visible_categories.map((c) => c.toLowerCase().trim())
    );
    const hiddenCategories: string[] = [];
    const hiddenSeen = new Set<string>();
    for (const a of toImport) {
      const cat = String(a.category || "").trim();
      if (!cat) continue;
      const key = cat.toLowerCase();
      if (!visibleLower.has(key) && !hiddenSeen.has(key)) {
        hiddenSeen.add(key);
        hiddenCategories.push(cat);
      }
    }

    return { success: true, imported: toImport.length, hiddenCategories };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Phase 1 audience & tag moderation (admin-only reads/writes)
//
// The full visitors list and per-tag detail are NEVER exposed to public
// clients (spec §5/§10): the public presence actions return only the
// caller's own record, and the full list is read here, behind checkAdminAuth.
// ---------------------------------------------------------------------------

async function readAlbumManifest(albumId: string): Promise<any | null> {
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!bucket) return null;
  const r2 = getR2WriteClient();
  const obj = await r2.send(
    new GetObjectCommand({ Bucket: bucket, Key: `${albumId}/manifest.json` })
  );
  const str = await obj.Body?.transformToString();
  if (!str) return null;
  const manifest = JSON.parse(str);
  return manifest && typeof manifest === "object" && !Array.isArray(manifest)
    ? manifest
    : null;
}

async function readAlbumManifestTeamLook(albumId: string): Promise<string> {
  try {
    const manifest = await readAlbumManifest(albumId);
    return normalizeTeamLook(manifest?.teamLook);
  } catch {
    // A missing/unreadable manifest must not block auto-tagging; the
    // category-level description remains the fallback.
    return "";
  }
}

export interface AdminAudienceTag {
  photoId: string;
  playerKey: string;
  taggedByVisitorId: string;
  createdAt: number;
  source?: "manual" | "auto" | "burst";
}

async function readAlbumJsonFile<T>(r2: S3Client, bucket: string, key: string): Promise<T[]> {
  try {
    const obj = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const str = await obj.Body?.transformToString();
    if (str) {
      const data = JSON.parse(str);
      if (Array.isArray(data)) return data as T[];
    }
  } catch {
    // missing file -> empty
  }
  return [];
}

/** Full per-album audience (visitors incl. claim snapshots + activity
 *  counters), the album's tag list, and auto-tag status, for the admin
 *  Audience panel. */
export async function getAlbumAudience(albumId: string): Promise<{
  success: boolean;
  visitors: any[];
  tags: AdminAudienceTag[];
  autoProcessedPhotoIds: string[];
  lastAutoTagRun: AutoTagRunSummary | null;
  error?: string;
}> {
  const notConfigured = {
    visitors: [] as any[],
    tags: [] as AdminAudienceTag[],
    autoProcessedPhotoIds: [] as string[],
    lastAutoTagRun: null,
  };
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, ...notConfigured, error: "Unauthorized" };

    const bucket = process.env.R2_BUCKET_NAME?.trim();
    if (!bucket) return { success: false, ...notConfigured, error: "R2_BUCKET_NAME is not set." };

    const id = String(albumId || "").trim();
    if (!id) return { success: false, ...notConfigured, error: "Missing album id." };

    const r2 = getR2WriteClient();
    const visitors = await readAlbumJsonFile<any>(r2, bucket, `${id}/visitors.json`);
    const tagsData = await readTagsFile(id);
    return {
      success: true,
      visitors,
      tags: tagsData.tags as AdminAudienceTag[],
      autoProcessedPhotoIds: tagsData.autoProcessedPhotoIds,
      lastAutoTagRun: tagsData.lastAutoTagRun,
      };
  } catch (err: any) {
    return { success: false, ...notConfigured, error: err?.message || String(err) };
  }
}

/** Admin moderation: remove any tag on an album (visitors can only remove
 *  their own, via removeAlbumTag). */
export async function adminRemoveAlbumTag(
  albumId: string,
  photoId: string,
  playerKey: string
): Promise<{ success: boolean; tags: AdminAudienceTag[]; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, tags: [], error: "Unauthorized" };

    const bucket = process.env.R2_BUCKET_NAME?.trim();
    if (!bucket) return { success: false, tags: [], error: "R2_BUCKET_NAME is not set." };

    const id = String(albumId || "").trim();
    const pid = String(photoId || "").trim();
    const key = String(playerKey || "").trim();
    if (!id || !pid || !key) return { success: false, tags: [], error: "Missing tag details." };

    const data = await readTagsFile(id);
    const next = data.tags.filter((t) => !(t.photoId === pid && t.playerKey === key));
    if (next.length !== data.tags.length) {
      data.tags = next;
      const ok = await writeTagsFile(id, data);
      if (!ok) return { success: false, tags: data.tags as AdminAudienceTag[], error: "Could not save." };
    }
    return { success: true, tags: next as AdminAudienceTag[] };
  } catch (err: any) {
    return { success: false, tags: [], error: err?.message || String(err) };
  }
}

/** Bulk-clear every machine-made tag on an album and reset the
 *  auto-processed markers, so auto-tag can be re-run from scratch.
 *  Human (manual) tags are never touched. */
export async function clearAutoTags(
  albumId: string
): Promise<{ success: boolean; removed: number; tags: AdminAudienceTag[]; error?: string }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, removed: 0, tags: [], error: "Unauthorized" };

    const id = String(albumId || "").trim();
    if (!id) return { success: false, removed: 0, tags: [], error: "Missing album id." };

    const data = await readTagsFile(id);
    const kept = data.tags.filter((t) => tagSource(t) !== "auto");
    const removed = data.tags.length - kept.length;
    const hadProcessed = data.autoProcessedPhotoIds.length > 0;
    if (removed === 0 && !hadProcessed) {
      return { success: true, removed: 0, tags: data.tags as AdminAudienceTag[] };
    }
    data.tags = kept;
    data.autoProcessedPhotoIds = [];
    const ok = await writeTagsFile(id, data);
    if (!ok) return { success: false, removed: 0, tags: data.tags as AdminAudienceTag[], error: "Could not save." };
    return { success: true, removed, tags: kept as AdminAudienceTag[] };
  } catch (err: any) {
    return { success: false, removed: 0, tags: [], error: err?.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Burst fill (admin only): free, sequence-based tag propagation.
//
// This uses only the album's stored manifest order, photo timestamps, and
// existing tags — no Gemini call or other external service. It is additive
// only: existing tags are never changed or removed, and duplicate
// (photo, player) pairs are never created.
// ---------------------------------------------------------------------------

const BURST_MAX_SANDWICH_RUN = 10;
const BURST_MAX_NEIGHBOR_GAP_MS = 3_000;
const BURST_MAX_CLUSTER_SPAN_MS = 30_000;

export interface BurstFillResult {
  success: boolean;
  tagsAdded: number;
  photosFilled: number;
  playersInvolved: number;
  error?: string;
}

function burstTimestampMs(photo: any): number | null {
  const raw = photo?.metadata?.lastModified;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw)
        : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function burstFillAlbum(albumId: string): Promise<BurstFillResult> {
  const empty = { tagsAdded: 0, photosFilled: 0, playersInvolved: 0 };
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false, ...empty, error: "Unauthorized" };

    const id = String(albumId || "").trim();
    if (!id) return { success: false, ...empty, error: "Missing album id." };

    const manifest = await readAlbumManifest(id);
    if (!manifest || !Array.isArray(manifest.photos)) {
      return { success: false, ...empty, error: "Album manifest not found." };
    }

    const orderedPhotos: any[] = [];
    const seenPhotoIds = new Set<string>();
    for (const photo of manifest.photos) {
      const photoId = String(photo?.id || "").trim();
      if (!photoId || seenPhotoIds.has(photoId)) continue;
      seenPhotoIds.add(photoId);
      orderedPhotos.push(photo);
    }
    const photoIds = orderedPhotos.map((photo) => String(photo.id).trim());
    if (photoIds.length === 0) return { success: true, ...empty };

    const data = await readTagsFile(id);
    const initialTagsByPhoto = new Map<string, typeof data.tags>();
    for (const tag of data.tags) {
      if (!seenPhotoIds.has(tag.photoId)) continue;
      const arr = initialTagsByPhoto.get(tag.photoId) || [];
      arr.push(tag);
      initialTagsByPhoto.set(tag.photoId, arr);
    }

    const tagKey = (photoId: string, playerKey: string) => `${photoId}\u0000${playerKey}`;
    const existing = new Set(data.tags.map((t) => tagKey(t.photoId, t.playerKey)));
    const queued = new Map<string, (typeof data.tags)[number]>();
    const createdAt = Date.now();
    const queueTag = (photoId: string, playerKey: string) => {
      const key = tagKey(photoId, playerKey);
      if (existing.has(key) || queued.has(key)) return;
      queued.set(key, {
        photoId,
        playerKey,
        taggedByVisitorId: "burst",
        createdAt,
        source: "burst",
      });
    };

    // Sandwich fill: a maximal run of photos with no tags at all, bounded
    // on both sides by the same player, inherits that player's tag. Runs
    // longer than the cap are left alone entirely.
    let index = 0;
    while (index < photoIds.length) {
      if ((initialTagsByPhoto.get(photoIds[index]) || []).length > 0) {
        index += 1;
        continue;
      }
      const runStart = index;
      while (
        index < photoIds.length &&
        (initialTagsByPhoto.get(photoIds[index]) || []).length === 0
      ) {
        index += 1;
      }
      const runEnd = index; // exclusive
      const runLength = runEnd - runStart;
      if (runLength <= BURST_MAX_SANDWICH_RUN && runStart > 0 && runEnd < photoIds.length) {
        const leftPlayers = new Set(
          (initialTagsByPhoto.get(photoIds[runStart - 1]) || []).map((t) => t.playerKey)
        );
        const rightPlayers = new Set(
          (initialTagsByPhoto.get(photoIds[runEnd]) || []).map((t) => t.playerKey)
        );
        for (const playerKey of leftPlayers) {
          if (!rightPlayers.has(playerKey)) continue;
          for (let i = runStart; i < runEnd; i += 1) queueTag(photoIds[i], playerKey);
        }
      }
    }

    // Burst clusters are used only when the whole manifest has usable,
    // strictly increasing timestamps. Any missing, equal, or backwards
    // timestamp disables clustering (sandwich fill above still applies).
    const timestamps = orderedPhotos.map(burstTimestampMs);
    const timestampsUsable =
      timestamps.length > 1 &&
      timestamps.every((value) => value !== null) &&
      timestamps.every((value, i) => i === 0 || value! > timestamps[i - 1]!);
    if (timestampsUsable) {
      const times = timestamps as number[];
      let clusterStart = 0;
      while (clusterStart < photoIds.length) {
        let clusterEnd = clusterStart;
        while (
          clusterEnd + 1 < photoIds.length &&
          times[clusterEnd + 1] - times[clusterEnd] <= BURST_MAX_NEIGHBOR_GAP_MS &&
          times[clusterEnd + 1] - times[clusterStart] <= BURST_MAX_CLUSTER_SPAN_MS
        ) {
          clusterEnd += 1;
        }
        if (clusterEnd > clusterStart) {
          const clusterPlayers = new Set<string>();
          for (let i = clusterStart; i <= clusterEnd; i += 1) {
            for (const tag of initialTagsByPhoto.get(photoIds[i]) || []) {
              clusterPlayers.add(tag.playerKey);
            }
          }
          for (let i = clusterStart; i <= clusterEnd; i += 1) {
            for (const playerKey of clusterPlayers) queueTag(photoIds[i], playerKey);
          }
        }
        clusterStart = clusterEnd + 1;
      }
    }

    const additions = [...queued.values()];
    if (additions.length === 0) return { success: true, ...empty };

    // One write for the whole fill. Only data.tags changes; the auto-tag
    // processed markers and last-run summary are deliberately untouched.
    data.tags.push(...additions);
    const ok = await writeTagsFile(id, data);
    if (!ok) return { success: false, ...empty, error: "Could not save the burst-fill tags." };

    return {
      success: true,
      tagsAdded: additions.length,
      photosFilled: new Set(additions.map((t) => t.photoId)).size,
      playersInvolved: new Set(additions.map((t) => t.playerKey)).size,
    };
  } catch (err: any) {
    return { success: false, ...empty, error: err?.message || String(err) };
  }
}
