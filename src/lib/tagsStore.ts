import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * Server-side storage for per-album player tags (spec §3), shared by the
 * public tag actions and the admin actions. Lives in `{albumId}/tags.json`
 * next to visitors.json — never inside manifest.json, so tagging never
 * rewrites album data.
 *
 * File format (Phase 2): an object —
 *   { tags: TagRecord[],
 *     autoProcessedPhotoIds: string[],   // photos the auto-tagger has read
 *     lastAutoTagRun: AutoTagRunSummary | null }
 * Legacy files are a bare TagRecord[] (Phase 1); parsing wraps them with
 * empty metadata, and every write upgrades the file to the object format
 * while preserving all tags.
 */

export interface TagRecord {
  photoId: string;
  playerKey: string;
  /** Visitor id for human tags; the literal "auto" for machine tags. */
  taggedByVisitorId: string;
  createdAt: number;
  /** Absent on Phase 1 records — those are manual. */
  source?: "manual" | "auto";
}

export interface AutoTagRunSummary {
  /** Epoch ms when the run finished (or was cancelled). */
  at: number;
  /** Photos read by the model in this run. */
  processed: number;
  /** Photos skipped because they were already auto-processed earlier. */
  skipped: number;
  /** Photos whose read failed in this run. */
  failed: number;
  /** New tags created in this run. */
  tagsCreated: number;
  /** Jersey numbers read that are not on the roster (counted per sighting). */
  unknownNumbers: number;
}

export interface TagsFileData {
  tags: TagRecord[];
  autoProcessedPhotoIds: string[];
  lastAutoTagRun: AutoTagRunSummary | null;
}

export function tagSource(t: TagRecord): "manual" | "auto" {
  return t.source === "auto" ? "auto" : "manual";
}

export function emptyTagsFile(): TagsFileData {
  return { tags: [], autoProcessedPhotoIds: [], lastAutoTagRun: null };
}

export function parseTagsFileText(text: string | undefined): TagsFileData {
  if (!text) return emptyTagsFile();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return { tags: parsed as TagRecord[], autoProcessedPhotoIds: [], lastAutoTagRun: null };
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Partial<TagsFileData>;
      return {
        tags: Array.isArray(obj.tags) ? (obj.tags as TagRecord[]) : [],
        autoProcessedPhotoIds: Array.isArray(obj.autoProcessedPhotoIds)
          ? obj.autoProcessedPhotoIds.map((x) => String(x))
          : [],
        lastAutoTagRun:
          obj.lastAutoTagRun && typeof obj.lastAutoTagRun === "object"
            ? (obj.lastAutoTagRun as AutoTagRunSummary)
            : null,
      };
    }
  } catch {
    // fall through to empty
  }
  return emptyTagsFile();
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

export function tagsStorageConfigured(): boolean {
  return Boolean(BUCKET && process.env.R2_ENDPOINT);
}

export async function readTagsFile(albumId: string): Promise<TagsFileData> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `${albumId}/tags.json` })
    );
    const data = await res.Body?.transformToString();
    return parseTagsFileText(data);
  } catch {
    // no tags yet
    return emptyTagsFile();
  }
}

export async function writeTagsFile(
  albumId: string,
  data: TagsFileData
): Promise<boolean> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${albumId}/tags.json`,
        Body: JSON.stringify(data, null, 2),
        ContentType: "application/json",
        CacheControl: "no-cache",
      })
    );
    return true;
  } catch {
    return false;
  }
}
