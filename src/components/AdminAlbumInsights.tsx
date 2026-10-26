"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  RefreshCw,
  Trash2,
  Loader2,
  Tag,
  Download,
  Eye,
  Eraser,
  Layers,
} from "lucide-react";
import {
  adminAddAlbumTag,
  adminRemoveAlbumTag,
  burstFillAlbum,
  clearAutoTags,
  getAlbumAudience,
} from "@/app/admin/actions";
import { playerKeyFor, playerKeyLabel, rosterForCategory } from "@/lib/players";
import { DEFAULT_PUBLIC_CONFIG, PublicSiteConfig } from "@/lib/types";

interface AdminAlbumInsightsProps {
  albumId: string;
  category: string;
  photos: {
    id: string;
    original_filename: string;
    type?: string;
    urls?: { thumb?: string; display?: string };
  }[];
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
  source?: "manual" | "auto" | "burst";
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

  const [clearBusy, setClearBusy] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [sweepPlayerKey, setSweepPlayerKey] = useState<string | null>(null);
  const [sweepBusyPhotoId, setSweepBusyPhotoId] = useState<string | null>(null);
  const [sweepError, setSweepError] = useState("");
  const [burstBusy, setBurstBusy] = useState(false);
  const [burstResult, setBurstResult] = useState<{
    tagsAdded: number;
    photosFilled: number;
    playersInvolved: number;
  } | null>(null);
  const [burstError, setBurstError] = useState("");

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

  const imagePhotos = useMemo(
    () => photos.filter((p) => p.type !== "video" && p.urls?.display),
    [photos]
  );
  const autoTagCount = useMemo(
    () => tags.filter((t) => t.source === "auto").length,
    [tags]
  );
  const burstTagCount = useMemo(
    () => tags.filter((t) => t.source === "burst").length,
    [tags]
  );
  /** Tag Sweep options: the category roster (active players), plus any
   *  player key already tagged on this album so an off-roster player can
   *  keep being swept. */
  const sweepOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of rosterForCategory(rosters, category)) {
      if (!p.active) continue;
      const key = playerKeyFor(category, p.number);
      m.set(key, playerKeyLabel(key, rosters));
    }
    for (const t of tags) {
      if (!m.has(t.playerKey)) m.set(t.playerKey, playerKeyLabel(t.playerKey, rosters));
    }
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  }, [rosters, category, tags]);

  const sweepPhotos = useMemo(
    () => photos.filter((p) => p.urls?.thumb),
    [photos]
  );

  const sweepTaggedIds = useMemo(() => {
    if (!sweepPlayerKey) return new Set<string>();
    return new Set(
      tags.filter((t) => t.playerKey === sweepPlayerKey).map((t) => t.photoId)
    );
  }, [tags, sweepPlayerKey]);

  const handleSweepToggle = async (photoId: string) => {
    if (!sweepPlayerKey || sweepBusyPhotoId) return;
    const key = sweepPlayerKey;
    const isTagged = sweepTaggedIds.has(photoId);
    setSweepError("");
    setSweepBusyPhotoId(photoId);
    // Optimistic update; the server response (or a reload on failure)
    // replaces it with the stored truth.
    setTags((prev) =>
      isTagged
        ? prev.filter((t) => !(t.photoId === photoId && t.playerKey === key))
        : [
            ...prev,
            {
              photoId,
              playerKey: key,
              taggedByVisitorId: "admin",
              createdAt: Date.now(),
              source: "manual" as const,
            },
          ]
    );
    try {
      const res = isTagged
        ? await adminRemoveAlbumTag(albumId, photoId, key)
        : await adminAddAlbumTag(albumId, photoId, key);
      if (!res.success) throw new Error(res.error || "Could not save the tag.");
      setTags(res.tags as AudienceTag[]);
    } catch (e: any) {
      setSweepError(e?.message || "Could not save the tag — reloaded the saved tags.");
      await load();
    } finally {
      setSweepBusyPhotoId(null);
    }
  };

  const handleBurstFill = async () => {
    if (burstBusy) return;
    setBurstBusy(true);
    setBurstResult(null);
    setBurstError("");
    try {
      const res = await burstFillAlbum(albumId);
      if (!res.success) throw new Error(res.error || "Burst fill failed.");
      setBurstResult({
        tagsAdded: res.tagsAdded,
        photosFilled: res.photosFilled,
        playersInvolved: res.playersInvolved,
      });
      await load();
    } catch (e: any) {
      setBurstError(e?.message || "Burst fill failed.");
    } finally {
      setBurstBusy(false);
    }
  };

  const handleClearAutoTags = async () => {
    if (clearBusy) return;
    if (
      !window.confirm(
        "Remove all auto (machine-made) tags from this album?\n\nManual and burst tags stay untouched."
      )
    )
      return;
    setClearBusy(true);
    try {
      const res = await clearAutoTags(albumId);
      if (res.success) {
        await load();
      }
    } finally {
      setClearBusy(false);
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

      {/* Tagging tools: burst fill (free) + cleanup of past machine tags.
          The Gemini auto-tag reader was removed 2026-10-21 (per-call cost
          wasn't sustainable); existing auto tags stay until cleared. */}
      <div className="space-y-3 p-4 bg-neutral-950/70 border border-neutral-800 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
            <Layers size={13} className="text-emerald-400" />
            Tagging tools
          </h3>
          <span className="text-[11px] font-mono text-neutral-500">
            {autoTagCount} auto tags · {burstTagCount} burst tags
          </span>
        </div>

        {autoTagCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleClearAutoTags}
              disabled={clearBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 text-xs font-semibold transition cursor-pointer"
            >
              {clearBusy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Eraser size={12} />
              )}
              Clear auto tags ({autoTagCount})
            </button>
            <span className="text-[11px] text-neutral-500">
              Removes the tags the retired Gemini reader created. Manual and
              burst tags are kept.
            </span>
          </div>
        )}

        <div className="space-y-2 border-t border-neutral-800 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
              <Layers size={13} className="text-emerald-400" />
              Burst fill — sequence gaps
            </h4>
            <span className="text-[11px] font-mono text-neutral-500">
              Free · uses existing tags only
            </span>
          </div>
          <p className="text-[11px] text-neutral-500 leading-relaxed">
            Fills short untagged gaps between photos of the same player and
            spreads each player&apos;s tag across tight bursts (frames no more
            than 3 seconds apart, 30 seconds end to end). It only adds Burst
            tags; existing tags are never changed.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleBurstFill}
              disabled={burstBusy || loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition cursor-pointer"
            >
              {burstBusy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Layers size={13} />
              )}
              Fill gaps across bursts
            </button>
            {burstResult && (
              <span className="text-[11px] text-emerald-300/90 font-mono leading-relaxed">
                Added {burstResult.tagsAdded} tags · filled {burstResult.photosFilled}{" "}
                photos · {burstResult.playersInvolved} players involved
              </span>
            )}
          </div>
          {burstError && (
            <p className="text-[11px] text-red-400 font-mono leading-relaxed">
              Burst fill error: {burstError}
            </p>
          )}
        </div>

        {/* Tag Sweep: the admin initial pass. Pick any roster player, then
            tap photos to tag/untag them — no visitor claim involved. Tags
            are manual tags attributed to "admin". */}
        <div className="space-y-2 border-t border-neutral-800 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
              <Tag size={13} className="text-emerald-400" />
              Tag photos — initial sweep
            </h4>
            <button
              type="button"
              onClick={() => setSweepOpen((v) => !v)}
              className="inline-flex items-center px-3 py-1.5 min-h-[32px] rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] font-semibold transition cursor-pointer"
            >
              {sweepOpen ? "Close sweep" : "Open sweep"}
            </button>
          </div>
          <p className="text-[11px] text-neutral-500 leading-relaxed">
            Your seeding pass: pick any player on this team&apos;s roster,
            then tap photos to tag them — tap again to remove. Unlike the
            public page, no claim is needed here; tags you add are manual
            tags credited to Admin.
          </p>

          {sweepOpen && (
            <div className="space-y-3 pt-1">
              {sweepOptions.length === 0 ? (
                <p className="text-[11px] text-amber-300/90 leading-relaxed">
                  No roster for this category yet — add one under Team
                  Rosters first, then the sweep can pick from it.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {sweepOptions.map((opt) => {
                      const on = sweepPlayerKey === opt.key;
                      const count = tags.filter(
                        (t) => t.playerKey === opt.key
                      ).length;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setSweepPlayerKey(opt.key)}
                          aria-pressed={on}
                          className={`px-2.5 py-1.5 min-h-[34px] rounded-full text-[11px] font-semibold border transition cursor-pointer ${
                            on
                              ? "bg-emerald-600 border-emerald-500 text-white"
                              : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-white"
                          }`}
                        >
                          {opt.label}
                          <span className={on ? "text-emerald-200/80" : "text-neutral-500"}>
                            {" "}· {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {sweepPlayerKey ? (
                    <>
                      <p className="text-[11px] text-neutral-400">
                        Tagging:{" "}
                        <span className="font-semibold text-white">
                          {playerKeyLabel(sweepPlayerKey, rosters)}
                        </span>{" "}
                        — {sweepTaggedIds.size} of {sweepPhotos.length} photos
                        tagged. Tap a photo to tag it, tap again to remove the
                        tag.
                      </p>
                      {sweepError && (
                        <p className="text-[11px] text-red-400 font-mono leading-relaxed">
                          {sweepError}
                        </p>
                      )}
                      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 max-h-[480px] overflow-y-auto pr-1">
                        {sweepPhotos.map((photo) => {
                          const isTagged = sweepTaggedIds.has(photo.id);
                          const otherCount = (
                            tagsByPhoto.get(photo.id) || []
                          ).filter((t) => t.playerKey !== sweepPlayerKey).length;
                          const busy = sweepBusyPhotoId === photo.id;
                          return (
                            <button
                              key={photo.id}
                              type="button"
                              disabled={busy}
                              onClick={() => handleSweepToggle(photo.id)}
                              aria-pressed={isTagged}
                              title={
                                isTagged
                                  ? `Remove ${playerKeyLabel(sweepPlayerKey, rosters)} tag`
                                  : `Tag as ${playerKeyLabel(sweepPlayerKey, rosters)}`
                              }
                              className={`relative aspect-square rounded-lg overflow-hidden border-2 transition cursor-pointer disabled:opacity-60 ${
                                isTagged
                                  ? "border-emerald-500"
                                  : "border-transparent hover:border-neutral-500"
                              }`}
                            >
                              <img
                                src={photo.urls?.thumb}
                                alt={photo.original_filename}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                              {isTagged && (
                                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-600 text-white">
                                  Tagged
                                </span>
                              )}
                              {otherCount > 0 && (
                                <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-neutral-900/85 text-neutral-200 border border-neutral-700">
                                  +{otherCount}
                                </span>
                              )}
                              {busy && (
                                <span className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                  <Loader2 size={16} className="animate-spin text-white" />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-neutral-500">
                      Pick a player above to start tapping photos.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
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
                        const isAuto = t.source === "auto";
                        const isBurst = t.source === "burst";
                        return (
                          <span
                            key={t.playerKey}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-semibold ${
                              isAuto
                                ? "bg-amber-950/70 border-amber-800/60 text-amber-100"
                                : isBurst
                                  ? "bg-emerald-950/70 border-emerald-800/60 text-emerald-100"
                                  : "bg-blue-950/70 border-blue-800/60 text-blue-100"
                            }`}
                          >
                            {playerKeyLabel(t.playerKey, rosters)}
                            <span
                              className={
                                isAuto
                                  ? "text-amber-300/60 font-normal"
                                  : isBurst
                                    ? "text-emerald-300/60 font-normal"
                                    : "text-blue-300/60 font-normal"
                              }
                            >
                              {isAuto
                                ? "by Auto-tag"
                                : isBurst
                                  ? "by Burst"
                                  : t.taggedByVisitorId === "admin"
                                    ? "by Admin"
                                    : `by ${tagger?.claim?.displayName || tagger?.name || "a visitor"}`}
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
