"use server";

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * Phase 1 player tags (spec §3). Human-made only — no automated tagging.
 * Stored at `{albumId}/tags.json` next to visitors.json, deliberately NOT
 * inside manifest.json so tagging never rewrites album data.
 */
export interface TagRecord {
  photoId: string;
  playerKey: string;
  taggedByVisitorId: string;
  createdAt: number;
}

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT || "",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || "";

async function readTags(albumId: string): Promise<TagRecord[]> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${albumId}/tags.json` })
    );
    const data = await res.Body?.transformToString();
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // no tags yet
  }
  return [];
}

async function writeTags(albumId: string, tags: TagRecord[]): Promise<boolean> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${albumId}/tags.json`,
        Body: JSON.stringify(tags, null, 2),
        ContentType: "application/json",
        CacheControl: "no-cache",
      })
    );
    return true;
  } catch {
    return false;
  }
}

/** Public read: tags are photo metadata (player chips), shown to everyone.
 *  They carry pseudonymous visitor ids only — never names. */
export async function getAlbumTags(
  albumId: string
): Promise<{ success: boolean; tags: TagRecord[] }> {
  if (!BUCKET || !process.env.R2_ENDPOINT) return { success: false, tags: [] };
  return { success: true, tags: await readTags(albumId) };
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
  if (!BUCKET || !process.env.R2_ENDPOINT) {
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

  const tags = await readTags(albumId);
  // One record per (photo, player); a duplicate add is a no-op success.
  if (tags.some((t) => t.photoId === photoId && t.playerKey === playerKey)) {
    return { success: true, tags };
  }

  noteAdd(visitorId);
  tags.push({ photoId, playerKey, taggedByVisitorId: visitorId, createdAt: Date.now() });
  const ok = await writeTags(albumId, tags);
  return { success: ok, tags, error: ok ? undefined : "Could not save the tag." };
}

/** A visitor can remove only tags they made themselves (spec §3).
 *  The admin path (adminRemoveAlbumTag) can remove any tag. */
export async function removeAlbumTag(
  albumId: string,
  tag: { photoId: string; playerKey: string; visitorId: string }
): Promise<{ success: boolean; tags: TagRecord[] }> {
  if (!BUCKET || !process.env.R2_ENDPOINT) return { success: false, tags: [] };
  const photoId = String(tag?.photoId || "").trim();
  const playerKey = String(tag?.playerKey || "").trim();
  const visitorId = String(tag?.visitorId || "").trim();
  if (!photoId || !playerKey || !visitorId) return { success: false, tags: [] };

  const tags = await readTags(albumId);
  const next = tags.filter(
    (t) =>
      !(
        t.photoId === photoId &&
        t.playerKey === playerKey &&
        t.taggedByVisitorId === visitorId
      )
  );
  if (next.length === tags.length) return { success: true, tags };
  const ok = await writeTags(albumId, next);
  return { success: ok, tags: next };
}
