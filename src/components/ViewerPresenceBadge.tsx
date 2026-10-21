"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getOrCreateVisitorProfile,
  onVisitorProfileChange,
  removeVisitorClaim,
  updateVisitorName,
  VisitorProfile,
} from "@/lib/visitorIdentity";
import { ClaimSnapshot, logAlbumPresence } from "@/app/actions/presence";
import { playerKeyLabel } from "@/lib/players";
import { DEFAULT_PUBLIC_CONFIG, PublicSiteConfig } from "@/lib/types";
import { Edit3, X, Check, Trash2, UserRound } from "lucide-react";

interface ViewerPresenceBadgeProps {
  albumId: string;
  /** Opens the claim flow (owned by the album view). */
  onOpenClaim?: () => void;
}

function claimSnapshotFor(profile: VisitorProfile): ClaimSnapshot | null {
  const claims = profile.claims || [];
  if (claims.length === 0) return null;
  return {
    players: claims.map((c) => c.playerKey),
    relation: claims[0]?.relation ?? null,
    displayName: profile.name,
  };
}

/**
 * Phase 1 presence badge — PERSONAL ONLY (spec §5, Jae's decision §10).
 * A visitor sees their own identity/claim state and nothing about anyone
 * else. The full audience list exists only in the admin. Presence is still
 * logged per album (now with the claim snapshot + the caller's own record
 * is the only thing the action returns).
 */
export default function ViewerPresenceBadge({ albumId, onOpenClaim }: ViewerPresenceBadgeProps) {
  const [profile, setProfile] = useState<VisitorProfile | null>(null);
  const [siteConfig, setSiteConfig] = useState<PublicSiteConfig>(DEFAULT_PUBLIC_CONFIG);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [inputName, setInputName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const lastLoggedSignature = useRef<string>("");

  // Roster labels for claim display
  useEffect(() => {
    const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.replace(/\/$/, "");
    if (!baseUrl) return;
    fetch(`${baseUrl}/site_config_public.json`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        if (cfg) setSiteConfig({ ...DEFAULT_PUBLIC_CONFIG, ...cfg });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const current = getOrCreateVisitorProfile();
    setProfile(current);
    setInputName(current.name || "");
    return onVisitorProfileChange((next) => {
      setProfile(next);
      setInputName(next.name || "");
    });
  }, []);

  // Log presence on mount and whenever the identity/claim changes.
  // (A claim save re-logs so the admin audience view picks it up; like the
  // old name-save, this also refreshes lastSeen.)
  useEffect(() => {
    if (!profile) return;
    const snapshot = claimSnapshotFor(profile);
    const signature = JSON.stringify({
      id: profile.id,
      name: profile.name,
      emoji: profile.avatarEmoji,
      snapshot,
    });
    if (lastLoggedSignature.current === `${albumId}|${signature}`) return;
    lastLoggedSignature.current = `${albumId}|${signature}`;

    logAlbumPresence(albumId, {
      id: profile.id,
      name: profile.name || `Sideline ${profile.avatarAnimal}`,
      emoji: profile.avatarEmoji,
      color: profile.avatarColor,
      isCustomName: profile.isCustomName,
      claim: snapshot,
    }).catch(() => {});
  }, [albumId, profile]);

  const claims = useMemo(() => profile?.claims || [], [profile]);

  const claimSummary = useMemo(() => {
    if (claims.length === 0) return null;
    const first = playerKeyLabel(claims[0].playerKey, siteConfig.rosters);
    return claims.length === 1 ? `Here for ${first}` : `Here for ${first} +${claims.length - 1}`;
  }, [claims, siteConfig.rosters]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const updated = updateVisitorName(inputName);
    setProfile(updated);
    setIsSaving(false);
    setIsEditModalOpen(false);
  };

  if (!profile) return null;

  const currentDisplayName = profile.name || `Sideline ${profile.avatarAnimal}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Personal identity pill — the ONLY presence UI visitors get. */}
        <button
          onClick={() => setIsEditModalOpen(true)}
          className="group inline-flex items-center gap-2 px-3 py-2 rounded-full bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 transition cursor-pointer shadow-sm text-xs"
          title="Your identity on this device"
        >
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-neutral-800 text-[11px] border border-white/10">
            {profile.avatarEmoji}
          </span>
          <span className="font-medium text-neutral-200 group-hover:text-white">
            {profile.name || claimSummary || currentDisplayName}{" "}
            <span className="text-[10px] text-neutral-500 font-mono">(You)</span>
          </span>
          <span className="text-[11px] text-blue-400 font-mono flex items-center gap-1 pl-1 border-l border-neutral-800 group-hover:underline">
            <Edit3 size={11} />
            {profile.isCustomName || claims.length > 0 ? "Edit" : "Say Hi"}
          </span>
        </button>

        {claims.length > 0 && profile.name && claimSummary && (
          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-blue-950/50 border border-blue-900/60 text-[11px] text-blue-200">
            <UserRound size={11} />
            {claimSummary}
          </span>
        )}
      </div>

      {/* ----------------- PERSONAL IDENTITY MODAL ----------------- */}
      {isEditModalOpen && (
        <div
          className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
          onClick={() => setIsEditModalOpen(false)}
        >
          <div
            className="relative w-full max-w-sm bg-neutral-950 border border-neutral-800 rounded-2xl p-6 space-y-5 shadow-2xl max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-lg">
                  {profile.avatarEmoji}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Your Identity</h3>
                  <p className="text-xs text-neutral-400 font-mono">
                    Mascot: {profile.avatarAnimal}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveName} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300 block">
                  Your Name or Nickname
                </label>
                <input
                  type="text"
                  placeholder="e.g. Coach Dave, Sarah M., Grandma"
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-neutral-900 border border-neutral-800 rounded-xl text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500 font-sans"
                  autoFocus
                />
                <p className="text-[11px] text-neutral-500 leading-relaxed">
                  Saved to your device. Only the Becks see it — other visitors
                  never see who else is viewing.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-950/40 transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Check size={14} />
                  <span>{isSaving ? "Saving..." : "Save Name"}</span>
                </button>
              </div>
            </form>

            {/* My claimed players */}
            <div className="space-y-2 pt-1 border-t border-neutral-800/70">
              <p className="text-xs font-semibold text-neutral-300 pt-2">My Players</p>
              {claims.length === 0 ? (
                <p className="text-[11px] text-neutral-500 leading-relaxed">
                  You haven&apos;t picked a player yet. Pick one to get a
                  &quot;My Player&quot; view with only their photos.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {claims.map((c) => (
                    <div
                      key={c.playerKey}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">
                          {playerKeyLabel(c.playerKey, siteConfig.rosters)}
                        </p>
                        <p className="text-[10px] text-neutral-500 font-mono truncate">
                          {c.category}
                          {c.relation ? ` · ${c.relation}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setProfile(removeVisitorClaim(c.playerKey))}
                        className="p-2 rounded-lg text-neutral-500 hover:text-red-300 hover:bg-neutral-800 transition cursor-pointer shrink-0"
                        title="Remove this claim"
                        aria-label={`Remove claim for ${playerKeyLabel(c.playerKey, siteConfig.rosters)}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {onOpenClaim && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    onOpenClaim();
                  }}
                  className="w-full px-4 py-2.5 min-h-[40px] rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-xs font-semibold transition cursor-pointer"
                >
                  {claims.length === 0 ? "Pick your player" : "Add or change players for this album"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
