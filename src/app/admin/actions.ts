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
import { DEFAULT_PUBLIC_CONFIG, PublicSiteConfig, clampBrightness, sanitizeRosters, sanitizeTeamDescriptions, teamDescriptionFor } from "@/lib/types";
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

    const categoryCheck = await validateAlbumCategory(albumData.category);
    if (!categoryCheck.ok) return { success: false, error: categoryCheck.error };
    const category = categoryCheck.category;

    const r2 = getR2WriteClient();

    // 1. Save album manifest
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${albumData.album_id}/manifest.json`,
        Body: JSON.stringify({ ...albumData, category }, null, 2),
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

    const categoryCheck = await validateAlbumCategory(albumData.category);
    if (!categoryCheck.ok) return { success: false, error: categoryCheck.error };
    const category = categoryCheck.category;

    const r2 = getR2WriteClient();

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${albumData.album_id}/manifest.json`,
        Body: JSON.stringify({ ...albumData, category }, null, 2),
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

export interface AdminAudienceTag {
  photoId: string;
  playerKey: string;
  taggedByVisitorId: string;
  createdAt: number;
  source?: "manual" | "auto";
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
  geminiConfigured: boolean;
  error?: string;
}> {
  const notConfigured = {
    visitors: [] as any[],
    tags: [] as AdminAudienceTag[],
    autoProcessedPhotoIds: [] as string[],
    lastAutoTagRun: null,
    geminiConfigured: Boolean(getGeminiApiKey()),
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
      geminiConfigured: Boolean(getGeminiApiKey()),
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

// ---------------------------------------------------------------------------
// Phase 2 auto-tagging (admin only): jersey-number reading via Gemini.
//
// The browser drives the run photo by photo (same loop shape as uploads);
// each call below handles ONE photo: fetch its display-size version, ask
// Gemini for clearly readable jersey numbers on the SUBJECT team only,
// and turn numbers that match the album category's roster into tags with
// source "auto". Numbers are the only signal — no faces, no biometrics.
//
// The Gemini key comes from the GEMINI_API_KEY env var (Vercel). When it
// is absent every action reports { configured: false } and the admin UI
// explains how to enable the feature.
// ---------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-2.5-flash";

/** The Gemini API key. Env var names are case-sensitive on Vercel/Linux,
 *  so accept the lowercase spelling too — the variable was created as
 *  `gemini_api_key` in the dashboard (Jae, 2026-10-21) and the uppercase
 *  lookup saw nothing. */
function getGeminiApiKey(): string {
  return (process.env.GEMINI_API_KEY || process.env.gemini_api_key || "").trim();
}

/** Whether auto-tagging is configured (GEMINI_API_KEY present). Lets
 *  admin surfaces that don't load an album's audience (e.g. the category
 *  sweep) show the not-configured state up front instead of mid-run. */
export async function getAutoTagConfig(): Promise<{ configured: boolean }> {
  const isAuth = await checkAdminAuth();
  if (!isAuth) return { configured: false };
  return { configured: Boolean(getGeminiApiKey()) };
}

export interface AutoTagPhotoResult {
  success: boolean;
  configured: boolean;
  /** True when the photo was already auto-processed in an earlier run. */
  skipped?: boolean;
  /** Roster numbers the model read on this photo. */
  numbers: string[];
  /** New auto tags created by this call. */
  tagsCreated: number;
  /** Numbers read that are not on the (active) roster. */
  unknownNumbers: string[];
  error?: string;
}

function geminiNotConfigured(): AutoTagPhotoResult {
  return {
    success: false,
    configured: false,
    numbers: [],
    tagsCreated: 0,
    unknownNumbers: [],
    error:
      "Auto-tag isn't configured — add the GEMINI_API_KEY environment variable in Vercel to enable jersey-number reading.",
  };
}

/** Ask Gemini which jersey numbers are clearly readable in one photo.
 *  One retry on transient failures (rate limit / 5xx / network), per the
 *  phase-2 cost guardrails. Throws on a final failure. */
async function readJerseyNumbers(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
  teamDescription: string,
  rosterNumbers: string[]
): Promise<string[]> {
  const desc =
    teamDescription.trim() ||
    "the subject team — the team this photo album is about";
  const rosterHint = rosterNumbers.length
    ? ` Their roster numbers are: ${rosterNumbers.join(", ")}.`
    : "";
  const prompt =
    `Look at this sports photo. The subject team is: ${desc}.${rosterHint}\n\n` +
    `List the jersey numbers that are CLEARLY readable on players wearing the subject team's uniform. ` +
    `Rules: only numbers printed on the subject team's jerseys; ignore the opposing team, referees, coaches, spectators, banners, signs, advertisements and scoreboards; ` +
    `include a number only if you can actually read its digits in the image — never guess; if a number is partially hidden or blurry, leave it out.\n\n` +
    `Respond with ONLY a JSON array of number strings, e.g. ["12","7"]. If no subject-team jersey number is clearly readable, respond with [].`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const transient = res.status === 429 || res.status >= 500;
        const err = new Error(
          `Gemini request failed (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`
        );
        if (transient && attempt === 0) {
          lastError = err;
          continue;
        }
        throw err;
      }
      const json: any = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts)
        ? parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("")
        : "";
      return parseJerseyNumbers(text);
    } catch (err) {
      lastError = err;
      if (attempt === 0) continue; // single retry on network errors too
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini request failed.");
}

/** Defensive parse: accept a JSON array, or dig the first [...] out of
 *  prose/code fences. Items are coerced to trimmed strings, deduped. */
function parseJerseyNumbers(text: string): string[] {
  const coerce = (arr: unknown[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of arr) {
      const n = String(item ?? "").trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  };
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return coerce(parsed);
  } catch {
    // fall through to extraction
  }
  const match = trimmed.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return coerce(parsed);
    } catch {
      // give up below
    }
  }
  return [];
}

/**
 * Auto-tag ONE photo. The photo is marked auto-processed in tags.json
 * even when no number is readable, so re-runs skip it (resumability).
 * A photo that already has a tag for a player (any source) is never
 * double-tagged; numbers not on the category's active roster are
 * reported back as unknown instead of being tagged.
 */
export async function autoTagPhoto(
  albumId: string,
  photoId: string,
  displayUrl: string,
  category: string
): Promise<AutoTagPhotoResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return geminiNotConfigured();

  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) {
      return {
        success: false,
        configured: true,
        numbers: [],
        tagsCreated: 0,
        unknownNumbers: [],
        error: "Admin session expired. Please log in again.",
      };
    }

    const id = String(albumId || "").trim();
    const pid = String(photoId || "").trim();
    const url = String(displayUrl || "").trim();
    const cat = String(category || "").trim();
    if (!id || !pid || !url || !cat) {
      return {
        success: false,
        configured: true,
        numbers: [],
        tagsCreated: 0,
        unknownNumbers: [],
        error: "Missing photo details for auto-tag.",
      };
    }

    // Only ever fetch images from this site's own public bucket.
    const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.trim().replace(/\/$/, "");
    if (!baseUrl || !url.startsWith(`${baseUrl}/`)) {
      return {
        success: false,
        configured: true,
        numbers: [],
        tagsCreated: 0,
        unknownNumbers: [],
        error: "That photo URL isn't on this site's image host — refusing to fetch it.",
      };
    }

    const data = await readTagsFile(id);
    if (data.autoProcessedPhotoIds.includes(pid)) {
      return {
        success: true,
        configured: true,
        skipped: true,
        numbers: [],
        tagsCreated: 0,
        unknownNumbers: [],
      };
    }

    const config = await getPublicSiteConfig();
    const roster = rosterForCategory(config.rosters, cat).filter((p) => p.active);
    const rosterNumbers = roster.map((p) => p.number);
    const teamDescription = teamDescriptionFor(config.team_descriptions, cat);

    // Fetch the display-size (1920px) version only — never the original.
    const imgRes = await fetch(url, { cache: "no-store" });
    if (!imgRes.ok) {
      return {
        success: false,
        configured: true,
        numbers: [],
        tagsCreated: 0,
        unknownNumbers: [],
        error: `Could not load the photo (HTTP ${imgRes.status}).`,
      };
    }
    const mimeType = imgRes.headers.get("content-type")?.split(";")[0]?.trim() || "image/webp";
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (buffer.length > 12 * 1024 * 1024) {
      return {
        success: false,
        configured: true,
        numbers: [],
        tagsCreated: 0,
        unknownNumbers: [],
        error: "That photo's display version is unexpectedly large — skipped.",
      };
    }

    const numbers = await readJerseyNumbers(
      apiKey,
      buffer.toString("base64"),
      mimeType,
      teamDescription,
      rosterNumbers
    );

    const rosterSet = new Set(rosterNumbers);
    const unknownNumbers: string[] = [];
    let tagsCreated = 0;
    const now = Date.now();
    for (const n of numbers) {
      if (!rosterSet.has(n)) {
        unknownNumbers.push(n);
        continue;
      }
      const key = playerKeyFor(cat, n);
      if (data.tags.some((t) => t.photoId === pid && t.playerKey === key)) continue;
      data.tags.push({
        photoId: pid,
        playerKey: key,
        taggedByVisitorId: "auto",
        createdAt: now,
        source: "auto",
      });
      tagsCreated += 1;
    }

    data.autoProcessedPhotoIds = [...data.autoProcessedPhotoIds, pid];
    const ok = await writeTagsFile(id, data);
    if (!ok) {
      return {
        success: false,
        configured: true,
        numbers,
        tagsCreated: 0,
        unknownNumbers,
        error: "Could not save the auto-tag results.",
      };
    }

    return { success: true, configured: true, numbers, tagsCreated, unknownNumbers };
  } catch (err: any) {
    return {
      success: false,
      configured: true,
      numbers: [],
      tagsCreated: 0,
      unknownNumbers: [],
      error: err?.message || String(err),
    };
  }
}

/** Persist the summary of a finished (or cancelled) auto-tag run so the
 *  admin sees it on revisit. Counts are clamped to sane ranges. */
export async function finishAutoTagRun(
  albumId: string,
  summary: AutoTagRunSummary
): Promise<{ success: boolean }> {
  try {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return { success: false };

    const id = String(albumId || "").trim();
    if (!id) return { success: false };

    const clamp = (v: unknown) => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n > 0 ? Math.min(n, 1_000_000) : 0;
    };
    const data = await readTagsFile(id);
    data.lastAutoTagRun = {
      at: clamp(summary?.at) || Date.now(),
      processed: clamp(summary?.processed),
      skipped: clamp(summary?.skipped),
      failed: clamp(summary?.failed),
      tagsCreated: clamp(summary?.tagsCreated),
      unknownNumbers: clamp(summary?.unknownNumbers),
    };
    const ok = await writeTagsFile(id, data);
    return { success: ok };
  } catch {
    return { success: false };
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
