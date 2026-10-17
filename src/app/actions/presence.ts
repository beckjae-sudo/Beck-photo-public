"use server";

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

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

export async function logAlbumPresence(
  albumId: string,
  visitor: { id: string; name: string; emoji: string; color: string; isCustomName: boolean }
) {
  if (!BUCKET || !process.env.R2_ENDPOINT) {
    return { success: false, visitors: [] };
  }

  const key = `${albumId}/visitors.json`;
  let list: VisitorRecord[] = [];

  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const data = await res.Body?.transformToString();
    if (data) list = JSON.parse(data);
  } catch {
    list = [];
  }

  const now = Date.now();
  const existingIdx = list.findIndex((v) => v.id === visitor.id);

  if (existingIdx >= 0) {
    const existing = list[existingIdx];
    const aliases = existing.aliases || [];

    // Track name changes / alias history
    if (existing.name && existing.name !== visitor.name && !aliases.includes(existing.name)) {
      aliases.push(existing.name);
    }

    list[existingIdx] = {
      ...existing,
      name: visitor.name,
      emoji: visitor.emoji,
      color: visitor.color,
      isCustomName: visitor.isCustomName,
      lastSeen: now,
      visitCount: (existing.visitCount || 1) + 1,
      aliases,
    };
  } else {
    list.unshift({
      id: visitor.id,
      name: visitor.name,
      emoji: visitor.emoji,
      color: visitor.color,
      isCustomName: visitor.isCustomName,
      firstSeen: now,
      lastSeen: now,
      visitCount: 1,
      aliases: [],
    });
  }

  // Keep up to 300 unique visitors sorted by most recently active
  list = list.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 300);

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(list, null, 2),
        ContentType: "application/json",
        CacheControl: "no-cache",
      })
    );
    return { success: true, visitors: list };
  } catch (err) {
    return { success: false, visitors: list };
  }
}

export async function getAlbumPresence(albumId: string) {
  if (!BUCKET || !process.env.R2_ENDPOINT) return { visitors: [] };

  const key = `${albumId}/visitors.json`;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const data = await res.Body?.transformToString();
    return { visitors: data ? JSON.parse(data) : [] };
  } catch {
    return { visitors: [] };
  }
}
