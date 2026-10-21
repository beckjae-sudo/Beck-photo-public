"use client";

import { useState } from "react";
import { X, Check, Plus, Tag, Loader2 } from "lucide-react";
import { PlayerOption } from "@/lib/players";
import { TagRecord } from "@/app/actions/tags";

interface TagPickerProps {
  /** Photo being tagged; null keeps the picker closed. */
  photo: { id: string; original_filename: string } | null;
  options: PlayerOption[];
  /** All tags on this photo (any tagger). */
  photoTags: TagRecord[];
  visitorId: string;
  onToggle: (playerKey: string, currentlyTagged: boolean) => Promise<void>;
  onClose: () => void;
}

/**
 * Phase 1 tag picker (spec §3): one tap per player. Tags the visitor made
 * can be removed by them; tags made by others show as tagged but locked
 * (only the tagger or the admin can remove them).
 */
export default function TagPicker({
  photo,
  options,
  photoTags,
  visitorId,
  onToggle,
  onClose,
}: TagPickerProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (!photo) return null;

  const tagFor = (playerKey: string) => photoTags.find((t) => t.playerKey === playerKey);

  const handleClick = async (opt: PlayerOption) => {
    const existing = tagFor(opt.key);
    if (busyKey) return;
    if (existing && existing.taggedByVisitorId !== visitorId) return; // someone else's tag
    setBusyKey(opt.key);
    try {
      await onToggle(opt.key, Boolean(existing));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[96] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm bg-neutral-950 border border-neutral-800 rounded-2xl p-6 space-y-4 shadow-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-950/70 border border-blue-800/60 text-blue-400 flex items-center justify-center">
              <Tag size={17} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Tag a player</h3>
              <p className="text-xs text-neutral-400 truncate max-w-[220px]">
                {photo.original_filename}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
            aria-label="Close tag picker"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 overflow-y-auto pr-1">
          {options.length === 0 && (
            <p className="text-xs text-neutral-500 leading-relaxed">
              No players to pick from yet for this team.
            </p>
          )}
          {options.map((opt) => {
            const existing = tagFor(opt.key);
            const mine = existing?.taggedByVisitorId === visitorId;
            const locked = Boolean(existing) && !mine;
            const busy = busyKey === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                disabled={locked || busy}
                onClick={() => handleClick(opt)}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 min-h-[44px] rounded-xl border text-xs font-semibold transition ${
                  existing
                    ? mine
                      ? "bg-blue-950/70 border-blue-700/70 text-blue-100 cursor-pointer"
                      : "bg-neutral-900 border-neutral-800 text-neutral-400 cursor-not-allowed"
                    : "bg-neutral-900 border-neutral-800 text-neutral-200 hover:border-neutral-600 hover:text-white cursor-pointer"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{opt.label}</span>
                  {opt.isClaimed && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-blue-900/80 text-blue-200 border border-blue-800 shrink-0">
                      Yours
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono">
                  {busy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : existing ? (
                    <>
                      <Check size={13} className={mine ? "text-blue-300" : "text-neutral-500"} />
                      <span>{mine ? "Tagged by you" : "Tagged"}</span>
                    </>
                  ) : (
                    <>
                      <Plus size={13} />
                      <span>Tag</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Tags are added by people, never automatically. Tap a player you tagged
          to remove your tag.
        </p>
      </div>
    </div>
  );
}
