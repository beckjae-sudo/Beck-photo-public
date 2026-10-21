"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, RefreshCw, Trash2, Loader2, Tag, Download, Eye } from "lucide-react";
import { adminRemoveAlbumTag, getAlbumAudience } from "@/app/admin/actions";
import { playerKeyLabel, rosterForCategory } from "@/lib/players";
import { DEFAULT_PUBLIC_CONFIG, PublicSiteConfig } from "@/lib/types";

interface AdminAlbumInsightsProps {
  albumId: string;
  category: string;
  photos: { id: string; original_filename: string; urls?: { thumb?: string } }[];
}

interface AudienceVisitor {
  id: string;
  name: string;
  emoji?: string;
  isCustomName?: boolean;
  firstSeen: number;
  lastSeen: number;
  visitCount: number;
  claim?: {
    players: string[];
    relation: string | null;
    displayName: string | null;
  } | null;
  downloads?: number;
  tagsMade?: number;
}

interface AudienceTag {
  photoId: string;
  playerKey: string;
  taggedByVisitorId: string;
  createdAt: number;
}

function fmtWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * Phase 1 admin Audience panel (spec §5): per-album claimed viewers,
 * anonymous remainder, per-player rollups, and tag moderation. This is the
 * ONLY place the full audience is visible — public clients never receive
 * other visitors' records.
 */
export default function AdminAlbumInsights({ albumId, category, photos }: AdminAlbumInsightsProps) {
  const [visitors, setVisitors] = useState<AudienceVisitor[]>([]);
  const [tags, setTags] = useState<AudienceTag[]>([]);
  const [siteConfig, setSiteConfig] = useState<PublicSiteConfig>(DEFAULT_PUBLIC_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getAlbumAudience(albumId);
      if (!res.success) throw new Error(res.error || "Could not load audience.");
      setVisitors(res.visitors as AudienceVisitor[]);
      setTags(res.tags as AudienceTag[]);
    } catch (e: any) {
      setError(e?.message || "Could not load audience.");
    } finally {
      setLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    load();
    const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.replace(/\/$/, "");
    if (baseUrl) {
      fetch(`${baseUrl}/site_config_public.json`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg) => {
          if (cfg) setSiteConfig({ ...DEFAULT_PUBLIC_CONFIG, ...cfg });
        })
        .catch(() => {});
    }
  }, [load]);

  const rosters = siteConfig.rosters;
  const visitorById = useMemo(() => {
    const m = new Map<string, AudienceVisitor>();
    for (const v of visitors) m.set(v.id, v);
    return m;
  }, [visitors]);

  const claimed = useMemo(
    () => visitors.filter((v) => v.claim && (v.claim.players?.length || 0) > 0),
    [visitors]
  );
  const anonymous = useMemo(
    () => visitors.filter((v) => !(v.claim && (v.claim.players?.length || 0) > 0)),
    [visitors]
  );
  const totalDownloads = useMemo(
    () => visitors.reduce((sum, v) => sum + (v.downloads || 0), 0),
    [visitors]
  );

  /** Per-player rollups: roster players + anyone claimed/tagged off-roster. */
  const rollups = useMemo(() => {
    const keys = new Map<string, string>(); // key -> label
    for (const p of rosterForCategory(rosters, category)) {
      const key = `${category}::${p.number}`;
      keys.set(key, playerKeyLabel(key, rosters));
    }
    for (const v of claimed) {
      for (const k of v.claim?.players || []) keys.set(k, playerKeyLabel(k, rosters));
    }
    for (const t of tags) keys.set(t.playerKey, playerKeyLabel(t.playerKey, rosters));

    return [...keys.entries()].map(([key, label]) => {
      const fans = claimed.filter((v) => (v.claim?.players || []).includes(key));
      const playerTags = tags.filter((t) => t.playerKey === key);
      return {
        key,
        label,
        families: fans.length,
        visits: fans.reduce((s, v) => s + (v.visitCount || 0), 0),
        downloads: fans.reduce((s, v) => s + (v.downloads || 0), 0),
        tags: playerTags.length,
        photosTagged: new Set(playerTags.map((t) => t.photoId)).size,
      };
    });
  }, [rosters, category, claimed, tags]);

  const tagsByPhoto = useMemo(() => {
    const m = new Map<string, AudienceTag[]>();
    for (const t of tags) {
      const arr = m.get(t.photoId) || [];
      arr.push(t);
      m.set(t.photoId, arr);
    }
    return m;
  }, [tags]);

  const photoById = useMemo(() => {
    const m = new Map<string, { id: string; original_filename: string; urls?: { thumb?: string } }>();
    for (const p of photos) m.set(p.id, p);
    return m;
  }, [photos]);

  const handleRemoveTag = async (photoId: string, playerKey: string) => {
    const busyId = `${photoId}|${playerKey}`;
    setRemovingKey(busyId);
    try {
      const res = await adminRemoveAlbumTag(albumId, photoId, playerKey);
      if (res.success) setTags(res.tags as AudienceTag[]);
    } finally {
      setRemovingKey(null);
    }
  };

  return (
    <section className="bg-neutral-900/50 border border-neutral-800/80 rounded-2xl p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-blue-950/60 border border-blue-800/60 text-blue-400 rounded-xl">
            <Users size={17} />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Audience &amp; Tags</h2>
            <p className="text-xs text-neutral-400">
              Admin only — visitors never see each other, only themselves.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-200 text-xs font-semibold transition cursor-pointer"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total visitors", value: visitors.length, icon: Eye },
          { label: "Claimed", value: claimed.length, icon: Users },
          { label: "Downloads (files)", value: totalDownloads, icon: Download },
          { label: "Player tags", value: tags.length, icon: Tag },
        ].map((s) => (
          <div key={s.label} className="p-3 bg-neutral-950/70 border border-neutral-800 rounded-xl">
            <p className="text-[10px] font-mono text-neutral-500 uppercase flex items-center gap-1">
              <s.icon size={10} /> {s.label}
            </p>
            <p className="text-lg font-extrabold text-white mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Per-player rollups */}
      {rollups.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
            By player
          </h3>
          <div className="space-y-1.5">
            {rollups.map((r) => (
              <div
                key={r.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 bg-neutral-950/70 border border-neutral-800 rounded-lg text-xs"
              >
                <span className="font-semibold text-white min-w-[110px]">{r.label}</span>
                {r.families === 0 ? (
                  <span className="text-neutral-500 font-mono text-[11px]">not yet visited</span>
                ) : (
                  <span className="text-neutral-400 font-mono text-[11px]">
                    {r.families} {r.families === 1 ? "family" : "families"} · {r.visits} visits ·{" "}
                    {r.downloads} downloads
                  </span>
                )}
                <span className="text-neutral-500 font-mono text-[11px]">
                  {r.tags} tags on {r.photosTagged} photos
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Claimed viewers */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
          Claimed viewers ({claimed.length})
        </h3>
        {claimed.length === 0 ? (
          <p className="text-xs text-neutral-500">
            No one has claimed a player on this album yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {claimed.map((v) => (
              <div
                key={v.id}
                className="px-3 py-2.5 bg-neutral-950/70 border border-neutral-800 rounded-lg text-xs space-y-1"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-white">
                    {v.claim?.displayName || v.name}
                  </span>
                  {(v.claim?.players || []).map((k) => (
                    <span
                      key={k}
                      className="px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 text-[10px] font-mono"
                    >
                      {playerKeyLabel(k, rosters)}
                    </span>
                  ))}
                  {v.claim?.relation && (
                    <span className="text-neutral-500 text-[11px]">{v.claim.relation}</span>
                  )}
                </div>
                <p className="text-[11px] text-neutral-500 font-mono">
                  {v.visitCount || 1} visits · last {fmtWhen(v.lastSeen)} · downloaded{" "}
                  {v.downloads || 0} · tagged {v.tagsMade || 0}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Anonymous remainder */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
          Anonymous viewers ({anonymous.length})
        </h3>
        {anonymous.length === 0 ? (
          <p className="text-xs text-neutral-500">None yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {anonymous.slice(0, 60).map((v) => (
              <span
                key={v.id}
                className="px-2 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] text-neutral-400"
                title={`${v.visitCount || 1} visits · last ${fmtWhen(v.lastSeen)} · downloaded ${v.downloads || 0}`}
              >
                {v.emoji || "👤"} {v.name} · {v.visitCount || 1}×
              </span>
            ))}
            {anonymous.length > 60 && (
              <span className="px-2 py-1 text-[11px] text-neutral-500">
                +{anonymous.length - 60} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tags with moderation */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
          Tags on this album ({tags.length})
        </h3>
        {tags.length === 0 ? (
          <p className="text-xs text-neutral-500">No player tags yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {[...tagsByPhoto.entries()].map(([photoId, photoTags]) => {
              const photo = photoById.get(photoId);
              return (
                <div
                  key={photoId}
                  className="flex items-center gap-3 px-3 py-2 bg-neutral-950/70 border border-neutral-800 rounded-lg"
                >
                  {photo?.urls?.thumb ? (
                    <img
                      src={photo.urls.thumb}
                      alt=""
                      className="w-10 h-10 rounded-md object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-neutral-900 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-neutral-400 font-mono truncate">
                      {photo?.original_filename || photoId}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {photoTags.map((t) => {
                        const tagger = visitorById.get(t.taggedByVisitorId);
                        const busyId = `${photoId}|${t.playerKey}`;
                        return (
                          <span
                            key={t.playerKey}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-950/70 border border-blue-800/60 text-blue-100 text-[11px] font-semibold"
                          >
                            {playerKeyLabel(t.playerKey, rosters)}
                            <span className="text-blue-300/60 font-normal">
                              by {tagger?.claim?.displayName || tagger?.name || "a visitor"}
                            </span>
                            <button
                              type="button"
                              disabled={removingKey === busyId}
                              onClick={() => handleRemoveTag(photoId, t.playerKey)}
                              className="text-blue-300/70 hover:text-red-300 transition cursor-pointer disabled:opacity-50"
                              title="Remove this tag (admin)"
                              aria-label={`Remove tag ${playerKeyLabel(t.playerKey, rosters)} from this photo`}
                            >
                              {removingKey === busyId ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Trash2 size={11} />
                              )}
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
