"use client";

import { useEffect, useState } from "react";
import {
  getOrCreateVisitorProfile,
  updateVisitorName,
  VisitorProfile,
} from "@/lib/visitorIdentity";
import { logAlbumPresence, getAlbumPresence, VisitorRecord } from "@/app/actions/presence";
import { Edit3, X, Users, Check, Clock, History, Eye } from "lucide-react";

interface ViewerPresenceBadgeProps {
  albumId: string;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ViewerPresenceBadge({ albumId }: ViewerPresenceBadgeProps) {
  const [profile, setProfile] = useState<VisitorProfile | null>(null);
  const [visitors, setVisitors] = useState<VisitorRecord[]>([]);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAudienceModalOpen, setIsAudienceModalOpen] = useState(false);
  const [inputName, setInputName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const current = getOrCreateVisitorProfile();
    setProfile(current);
    setInputName(current.name || "");

    const displayName = current.name || `Sideline ${current.avatarAnimal}`;

    getAlbumPresence(albumId).then((res) => {
      if (res.visitors) setVisitors(res.visitors);
    });

    logAlbumPresence(albumId, {
      id: current.id,
      name: displayName,
      emoji: current.avatarEmoji,
      color: current.avatarColor,
      isCustomName: current.isCustomName,
    }).then((res) => {
      if (res.visitors) setVisitors(res.visitors);
    });
  }, [albumId]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    const updated = updateVisitorName(inputName);
    setProfile(updated);

    const displayName = updated.name || `Sideline ${updated.avatarAnimal}`;

    const res = await logAlbumPresence(albumId, {
      id: updated.id,
      name: displayName,
      emoji: updated.avatarEmoji,
      color: updated.avatarColor,
      isCustomName: updated.isCustomName,
    });

    if (res.visitors) setVisitors(res.visitors);

    setIsSaving(false);
    setIsEditModalOpen(false);
  };

  if (!profile) return null;

  const currentDisplayName = profile.name || `Sideline ${profile.avatarAnimal}`;

  // Viewers active within the last 5 minutes
  const activeNowCount = visitors.filter(
    (v) => Date.now() - v.lastSeen < 5 * 60 * 1000
  ).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        {/* User's Profile Pill */}
        <button
          onClick={() => setIsEditModalOpen(true)}
          className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 transition cursor-pointer shadow-sm text-xs"
          title="Click to change your screen name"
        >
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-neutral-800 text-[11px] border border-white/10">
            {profile.avatarEmoji}
          </span>
          <span className="font-medium text-neutral-200 group-hover:text-white">
            {currentDisplayName}{" "}
            <span className="text-[10px] text-neutral-500 font-mono">(You)</span>
          </span>
          <span className="text-[11px] text-blue-400 font-mono flex items-center gap-1 pl-1 border-l border-neutral-800 group-hover:underline">
            <Edit3 size={11} />
            {profile.isCustomName ? "Edit" : "Say Hi"}
          </span>
        </button>

        {/* Clickable Audience Counter & Avatar Stack */}
        {visitors.length > 0 && (
          <button
            onClick={() => setIsAudienceModalOpen(true)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-neutral-900/60 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 text-xs text-neutral-400 hover:text-white transition cursor-pointer"
            title="Click to view full audience roster and name histories"
          >
            <div className="flex -space-x-1.5 overflow-hidden p-0.5">
              {visitors.slice(0, 4).map((v) => (
                <div
                  key={v.id}
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-neutral-800 border-2 border-neutral-950 text-[10px] shadow-sm"
                >
                  {v.emoji || "👤"}
                </div>
              ))}
            </div>

            <span className="text-[11px] font-mono text-neutral-300 flex items-center gap-1.5">
              {activeNowCount > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              {visitors.length} {visitors.length === 1 ? "viewer" : "viewers"}
            </span>
          </button>
        )}
      </div>

      {/* ----------------- AUDIENCE ROSTER MODAL ----------------- */}
      {isAudienceModalOpen && (
        <div
          className="fixed inset-0 z-[85] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
          onClick={() => setIsAudienceModalOpen(false)}
        >
          <div
            className="relative w-full max-w-lg bg-neutral-950 border border-neutral-800 rounded-2xl p-6 space-y-6 shadow-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-950/60 border border-blue-800/60 text-blue-400 rounded-xl">
                  <Users size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Album Viewers</h3>
                  <p className="text-xs text-neutral-400">Audience activity &amp; identity history</p>
                </div>
              </div>
              <button
                onClick={() => setIsAudienceModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-xl">
                <p className="text-[11px] font-mono text-neutral-400 uppercase">Live Right Now</p>
                <p className="text-xl font-extrabold text-emerald-400 flex items-center gap-2 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {activeNowCount}
                </p>
              </div>
              <div className="p-3 bg-neutral-900/60 border border-neutral-800 rounded-xl">
                <p className="text-[11px] font-mono text-neutral-400 uppercase">Total Unique Visitors</p>
                <p className="text-xl font-extrabold text-white mt-0.5">{visitors.length}</p>
              </div>
            </div>

            {/* Scrollable Visitor Directory */}
            <div className="space-y-2.5 overflow-y-auto pr-1 flex-1">
              {visitors.map((v) => {
                const isActive = Date.now() - v.lastSeen < 5 * 60 * 1000;
                const isSelf = v.id === profile.id;

                return (
                  <div
                    key={v.id}
                    className="p-3 bg-neutral-900/40 border border-neutral-800/80 rounded-xl space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-neutral-800 border border-white/10 text-base shadow-sm">
                          {v.emoji}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-white">
                              {v.name}
                            </span>
                            {isSelf && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-blue-950 text-blue-300 border border-blue-800">
                                You
                              </span>
                            )}
                            {v.isCustomName && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-neutral-800 text-neutral-300">
                                Custom
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-neutral-500 font-mono">
                            ID: {v.id.slice(0, 8)}...
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium ${
                            isActive
                              ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                              : "text-neutral-400"
                          }`}
                        >
                          <Clock size={10} />
                          {isActive ? "Active Now" : formatTimeAgo(v.lastSeen)}
                        </span>
                        <p className="text-[10px] text-neutral-500 font-mono mt-0.5">
                          {v.visitCount || 1} {v.visitCount === 1 ? "session" : "sessions"}
                        </p>
                      </div>
                    </div>

                    {/* Alias / Screen Name Edit History */}
                    {v.aliases && v.aliases.length > 0 && (
                      <div className="pt-2 border-t border-neutral-800/60 flex items-center gap-1.5 text-[11px] text-neutral-400">
                        <History size={12} className="text-amber-400 shrink-0" />
                        <span className="text-[10px] text-neutral-500 font-mono">Formerly:</span>
                        <div className="flex flex-wrap gap-1">
                          {v.aliases.map((alias, aIdx) => (
                            <span
                              key={aIdx}
                              className="px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 text-[10px] font-mono"
                            >
                              &quot;{alias}&quot;
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ----------------- NAME EDIT MODAL ----------------- */}
      {isEditModalOpen && (
        <div
          className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
          onClick={() => setIsEditModalOpen(false)}
        >
          <div
            className="relative w-full max-w-sm bg-neutral-950 border border-neutral-800 rounded-2xl p-6 space-y-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-lg">
                  {profile.avatarEmoji}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Edit Your Screen Name</h3>
                  <p className="text-xs text-neutral-400 font-mono">
                    Mascot: {profile.avatarAnimal}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
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
                  Updates your identifier for this album and saves to your device.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
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
          </div>
        </div>
      )}
    </>
  );
}
