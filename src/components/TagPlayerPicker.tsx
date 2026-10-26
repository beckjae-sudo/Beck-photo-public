"use client";

import { X, Check, Tag } from "lucide-react";
import { PlayerOption } from "@/lib/players";

interface TagPlayerPickerProps {
  open: boolean;
  options: PlayerOption[];
  /** Currently sticky player key, if one is already chosen (Switch flow). */
  currentKey: string | null;
  onPick: (playerKey: string) => void;
  onClose: () => void;
}

/**
 * Tag mode's "pick once" player chooser (Phase 2 sticky tagging): the
 * visitor picks who they're tagging ONE time, then taps photos to apply
 * that player instantly — no per-photo "who is this?" prompt. Options are
 * the visitor's claimed players for this category (2026-10-26: viewers tag
 * only who they've claimed; tagging anyone is the admin Tag Sweep).
 */
export default function TagPlayerPicker({
  open,
  options,
  currentKey,
  onPick,
  onClose,
}: TagPlayerPickerProps) {
  if (!open) return null;

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
            <div className="w-10 h-10 rounded-xl bg-emerald-950/70 border border-emerald-800/60 text-emerald-400 flex items-center justify-center">
              <Tag size={17} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Who are you tagging?</h3>
              <p className="text-xs text-neutral-400">
                Pick once — then tap photos to tag them.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
            aria-label="Close player picker"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 overflow-y-auto pr-1">
          {options.length === 0 && (
            <p className="text-xs text-neutral-500 leading-relaxed">
              You tag the players you&apos;ve claimed — claim your player
              first (My Player, above), then come back to tag them. Here for
              more than one player? You can claim them all.
            </p>
          )}
          {options.map((opt) => {
            const isCurrent = opt.key === currentKey;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onPick(opt.key)}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 min-h-[44px] rounded-xl border text-xs font-semibold transition cursor-pointer ${
                  isCurrent
                    ? "bg-emerald-950/70 border-emerald-700/70 text-emerald-100"
                    : "bg-neutral-900 border-neutral-800 text-neutral-200 hover:border-neutral-600 hover:text-white"
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
                {isCurrent && <Check size={13} className="text-emerald-300 shrink-0" />}
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Tag mode stays on the player you pick until you switch or tap Done.
        </p>
      </div>
    </div>
  );
}
