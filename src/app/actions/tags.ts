"use server";

import {
  readTagsFile,
  writeTagsFile,
  tagSource,
  tagsStorageConfigured,
  TagRecord,
} from "@/lib/tagsStore";

/**
 * Phase 1 player tags (spec §3). Human-made tags plus machine-made tags:
 * "auto" from jersey-number reading and "burst" from sequence filling —
 * never face recognition. Stored at `{albumId}/tags.json` (see
 * lib/tagsStore.ts), deliberately NOT inside manifest.json so tagging
 * never rewrites album data.
 */
export type { TagRecord };

/** Public read: tags are photo metadata (player chips), shown to everyone.
 *  They carry pseudonymous visitor ids only — never names. */
export async function getAlbumTags(
  albumId: string
): Promise<{ success: boolean; tags: TagRecord[] }> {
  if (!tagsStorageConfigured()) return { success: false, tags: [] };
  const data = await readTagsFile(albumId);
  return { success: true, tags: data.tags };
}

/* Cheap per-visitor rate limit for tag creation (spec §3: ~60/min).
 * In-memory per server instance — a guardrail against runaway loops,
 * not a security boundary. */
const addHistory = new Map<string, number[]>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(visitorId: string): boolean {
  const now = Date.now();
  const recent = (addHistory.get(visitorId) || []).filter(
    (t) => now - t < RATE_WINDOW_MS
  );
  addHistory.set(visitorId, recent);
  return recent.length >= RATE_LIMIT;
}

function noteAdd(visitorId: string) {
  const recent = addHistory.get(visitorId) || [];
  recent.push(Date.now());
  addHistory.set(visitorId, recent);
}

export async function addAlbumTag(
  albumId: string,
  tag: { photoId: string; playerKey: string; visitorId: string }
): Promise<{ success: boolean; tags: TagRecord[]; error?: string }> {
  if (!tagsStorageConfigured()) {
    return { success: false, tags: [], error: "Tagging is unavailable." };
  }
  const photoId = String(tag?.photoId || "").trim();
  const playerKey = String(tag?.playerKey || "").trim();
  const visitorId = String(tag?.visitorId || "").trim();
  if (!photoId || !playerKey || !visitorId) {
    return { success: false, tags: [], error: "Missing tag details." };
  }
  if (isRateLimited(visitorId)) {
    return {
      success: false,
      tags: [],
      error: "You're tagging fast — give it a few seconds and try again.",
    };
  }

  const data = await readTagsFile(albumId);
  // One record per (photo, player); a duplicate add is a no-op success.
  if (data.tags.some((t) => t.photoId === photoId && t.playerKey === playerKey)) {
    return { success: true, tags: data.tags };
  }

  noteAdd(visitorId);
  data.tags.push({
    photoId,
    playerKey,
    taggedByVisitorId: visitorId,
    createdAt: Date.now(),
    source: "manual",
  });
  const ok = await writeTagsFile(albumId, data);
  return { success: ok, tags: data.tags, error: ok ? undefined : "Could not save the tag." };
}

/** A visitor can remove only manual tags they made themselves (spec §3).
 *  The admin path (adminRemoveAlbumTag) can remove any tag, and
 *  removeAutoTag below covers machine-made tags. */
export async function removeAlbumTag(
  albumId: string,
  tag: { photoId: string; playerKey: string; visitorId: string }
): Promise<{ success: boolean; tags: TagRecord[] }> {
  if (!tagsStorageConfigured()) return { success: false, tags: [] };
  const photoId = String(tag?.photoId || "").trim();
  const playerKey = String(tag?.playerKey || "").trim();
  const visitorId = String(tag?.visitorId || "").trim();
  if (!photoId || !playerKey || !visitorId) return { success: false, tags: [] };

  const data = await readTagsFile(albumId);
  const next = data.tags.filter(
    (t) =>
      !(
        t.photoId === photoId &&
        t.playerKey === playerKey &&
        t.taggedByVisitorId === visitorId &&
        tagSource(t) === "manual"
      )
  );
  if (next.length === data.tags.length) return { success: true, tags: data.tags };
  data.tags = next;
  const ok = await writeTagsFile(albumId, data);
  return { success: ok, tags: next };
}

/** Any claimed visitor may remove an AUTO or BURST tag: machine-made tags
 *  are provisional until a person confirms them, so correcting one is open
 *  to every claimed viewer — the "Not #12" fix. Manual tags never match
 *  here. (The function name predates burst tags and is kept for callers.) */
export async function removeAutoTag(
  albumId: string,
  tag: { photoId: string; playerKey: string; visitorId: string }
): Promise<{ success: boolean; tags: TagRecord[] }> {
  if (!tagsStorageConfigured()) return { success: false, tags: [] };
  const photoId = String(tag?.photoId || "").trim();
  const playerKey = String(tag?.playerKey || "").trim();
  const visitorId = String(tag?.visitorId || "").trim();
  if (!photoId || !playerKey || !visitorId) return { success: false, tags: [] };

  const data = await readTagsFile(albumId);
  const next = data.tags.filter(
    (t) =>
      !(
        t.photoId === photoId &&
        t.playerKey === playerKey &&
        (tagSource(t) === "auto" || tagSource(t) === "burst")
      )
  );
  if (next.length === data.tags.length) return { success: true, tags: data.tags };
  data.tags = next;
  const ok = await writeTagsFile(albumId, data);
  return { success: ok, tags: next };
}
