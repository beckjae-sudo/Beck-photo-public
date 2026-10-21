"use server";

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

/** Snapshot of a visitor's opt-in claim at the time of the visit (spec §5).
 *  Self-asserted; used for the owner's admin audience view only. */
export interface ClaimSnapshot {
  players: string[];
  relation: string | null;
  displayName: string | null;
}

export interface VisitorRecord {
  id: string;
  name: string;
  emoji: string;
  color: string;
  isCustomName: boolean;
  firstSeen: number;
  lastSeen: number;
  visitCount: number;
  aliases: string[];
  /** Phase 1 additions — optional so pre-existing records stay valid. */
  claim?: ClaimSnapshot | null;
  downloads?: number;
  tagsMade?: number;
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

async function readVisitors(albumId: string): Promise<VisitorRecord[]> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${albumId}/visitors.json` })
    );
    const data = await res.Body?.transformToString();
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // missing/unreadable -> start empty (same behavior as before)
  }
  return [];
}

async function writeVisitors(albumId: string, list: VisitorRecord[]): Promise<boolean> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${albumId}/visitors.json`,
        Body: JSON.stringify(list, null, 2),
        ContentType: "application/json",
        CacheControl: "no-cache",
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Log a visit. PRIVACY (Jae's decision, spec §5/§10): this returns ONLY the
 * caller's own record. The full audience list is never sent to public
 * clients — it is readable solely through the admin (authenticated)
 * getAlbumAudience action.
 */
export async function logAlbumPresence(
  albumId: string,
  visitor: {
    id: string;
    name: string;
    emoji: string;
    color: string;
    isCustomName: boolean;
    claim?: ClaimSnapshot | null;
  }
): Promise<{ success: boolean; self: VisitorRecord | null }> {
  if (!BUCKET || !process.env.R2_ENDPOINT) {
    return { success: false, self: null };
  }

  let list = await readVisitors(albumId);

  const now = Date.now();
  const existingIdx = list.findIndex((v) => v.id === visitor.id);
  let self: VisitorRecord;

  if (existingIdx >= 0) {
    const existing = list[existingIdx];
    const aliases = existing.aliases || [];

    // Track name changes / alias history
    if (existing.name && existing.name !== visitor.name && !aliases.includes(existing.name)) {
      aliases.push(existing.name);
    }

    self = {
      ...existing,
      name: visitor.name,
      emoji: visitor.emoji,
      color: visitor.color,
      isCustomName: visitor.isCustomName,
      claim: visitor.claim ?? existing.claim ?? null,
      lastSeen: now,
      visitCount: (existing.visitCount || 1) + 1,
      aliases,
    };
    list[existingIdx] = self;
  } else {
    self = {
      id: visitor.id,
      name: visitor.name,
      emoji: visitor.emoji,
      color: visitor.color,
      isCustomName: visitor.isCustomName,
      claim: visitor.claim ?? null,
      downloads: 0,
      tagsMade: 0,
      firstSeen: now,
      lastSeen: now,
      visitCount: 1,
      aliases: [],
    };
    list.unshift(self);
  }

  // Keep up to 300 unique visitors sorted by most recently active
  list = list.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 300);

  const ok = await writeVisitors(albumId, list);
  return { success: ok, self };
}

/**
 * Increment per-album activity counters (spec §5): downloads (file counts,
 * including ZIP contents) and tags made. Best-effort: a visitor with no
 * presence record yet is ignored (the badge logs presence on page load,
 * before any download/tag can happen). Does NOT count as a visit.
 */
export async function recordAlbumActivity(
  albumId: string,
  visitorId: string,
  deltas: { downloads?: number; tagsMade?: number }
): Promise<{ success: boolean }> {
  if (!BUCKET || !process.env.R2_ENDPOINT || !visitorId) return { success: false };

  const dDownloads = Math.max(0, Math.floor(deltas.downloads || 0));
  const dTags = Math.max(0, Math.floor(deltas.tagsMade || 0));
  if (dDownloads === 0 && dTags === 0) return { success: true };

  const list = await readVisitors(albumId);
  const idx = list.findIndex((v) => v.id === visitorId);
  if (idx < 0) return { success: false };

  list[idx] = {
    ...list[idx],
    downloads: (list[idx].downloads || 0) + dDownloads,
    tagsMade: (list[idx].tagsMade || 0) + dTags,
  };

  const ok = await writeVisitors(albumId, list);
  return { success: ok };
}
