"use client";

import { useEffect, useState } from "react";
import { X, Check, Plus, UserRound } from "lucide-react";
import { RosterPlayer } from "@/lib/types";
import {
  CLAIM_RELATIONS,
  VisitorClaim,
  freePlayerKey,
  parsePlayerKey,
  playerKeyFor,
  rosterPlayerLabel,
} from "@/lib/players";
import {
  VisitorProfile,
  setVisitorClaimsForCategory,
  updateVisitorName,
} from "@/lib/visitorIdentity";

interface ClaimModalProps {
  open: boolean;
  onClose: () => void;
  category: string;
  /** Roster for this album's category (may be empty -> free-text mode). */
  roster: RosterPlayer[];
  profile: VisitorProfile;
  onSaved: (profile: VisitorProfile) => void;
}

interface FreeOption {
  key: string;
  label: string;
}

/**
 * Phase 1 claim flow (spec §1): pick your player(s) -> relation (optional)
 * -> your name (optional). Saving is the whole opt-in; the visitor's reward
 * is the My Player filtered album. Used both for first claims and for
 * managing existing ones.
 */
export default function ClaimModal({
  open,
  onClose,
  category,
  roster,
  profile,
  onSaved,
}: ClaimModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [relation, setRelation] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [freeText, setFreeText] = useState("");
  const [freeOptions, setFreeOptions] = useState<FreeOption[]>([]);
  const [saving, setSaving] = useState(false);

  // (Re)initialize every time the modal opens.
  useEffect(() => {
    if (!open) return;
    const mine = (profile.claims || []).filter(
      (c) => c.category.trim().toLowerCase() === category.trim().toLowerCase()
    );
    setSelected(new Set(mine.map((c) => c.playerKey)));
    setRelation(mine[0]?.relation ?? null);
    setNameInput(profile.name || "");
    const frees: FreeOption[] = [];
    for (const c of mine) {
      const parsed = parsePlayerKey(c.playerKey);
      if (parsed.freeText) frees.push({ key: c.playerKey, label: parsed.freeText });
    }
    setFreeOptions(frees);
    setFreeText("");
  }, [open, profile, category ]);

  if (!open) return null;

  const rosterOptions = roster
    .filter((p) => p.active)
    .map((p) => ({ key: playerKeyFor(category, p.number), label: rosterPlayerLabel(p) }));
  // A claimed player who has since left the roster stays visible/checkable.
  const extraClaimed = [...selected]
    .filter(
      (key) =>
        !rosterOptions.some((o) => o.key === key) &&
        !freeOptions.some((o) => o.key === key)
    )
    .map((key) => {
      const parsed = parsePlayerKey(key);
      return { key, label: parsed.number ? `#${parsed.number}` : key };
    });
  const allOptions = [...rosterOptions, ...extraClaimed, ...freeOptions];

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addFree = () => {
    const text = freeText.trim();
    if (!text) return;
    // If they typed a roster player's number (with or without '#'), select
    // the roster entry instead of minting a parallel free-text identity.
    const numPart = text.replace(/^#/, "").trim();
    const rosterMatch = roster.find(
      (p) => p.number === numPart || rosterPlayerLabel(p).toLowerCase() === text.toLowerCase()
    );
    if (rosterMatch) {
      setSelected((prev) => new Set(prev).add(playerKeyFor(category, rosterMatch.number)));
      setFreeText("");
      return;
    }
    const key = freePlayerKey(category, text);
    setFreeOptions((prev) =>
      prev.some((o) => o.key === key) ? prev : [...prev, { key, label: text }]
    );
    setSelected((prev) => new Set(prev).add(key));
    setFreeText("");
  };

  const handleSave = () => {
    setSaving(true);
    const claims: VisitorClaim[] = [...selected].map((playerKey) => ({
      playerKey,
      category,
      relation,
    }));
    let updated = setVisitorClaimsForCategory(category, claims);
    if ((updated.name || "") !== nameInput.trim()) {
      updated = updateVisitorName(nameInput);
    }
    setSaving(false);
    onSaved(updated);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-neutral-950 border border-neutral-800 rounded-2xl p-6 space-y-5 shadow-2xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-950/70 border border-blue-800/60 text-blue-400 flex items-center justify-center">
              <UserRound size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Who are you here for?</h3>
              <p className="text-xs text-neutral-400">
                {category} — pick a player, see only their photos.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step 1: player(s) */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-neutral-300">
            1 · Your player <span className="text-neutral-500 font-normal">(tap all that apply)</span>
          </p>
          {allOptions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {allOptions.map((opt) => {
                const on = selected.has(opt.key);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => toggle(opt.key)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-full text-xs font-semibold border transition cursor-pointer ${
                      on
                        ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-950/40"
                        : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-white"
                    }`}
                  >
                    {on && <Check size={12} strokeWidth={3} />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-neutral-500 leading-relaxed">
              No roster for this team yet — add your player by jersey number or name below.
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFree();
                }
              }}
              placeholder={roster.length > 0 ? "Player not listed? Add # or name" : "e.g. #12 or Walker"}
              className="flex-1 min-w-0 px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-xl text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={addFree}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold transition cursor-pointer"
            >
              <Plus size={13} /> Add
            </button>
          </div>
        </div>

        {/* Step 2: relation (optional) */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-neutral-300">
            2 · You are their… <span className="text-neutral-500 font-normal">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {CLAIM_RELATIONS.map((rel) => {
              const on = relation === rel;
              return (
                <button
                  key={rel}
                  type="button"
                  onClick={() => setRelation(on ? null : rel)}
                  aria-pressed={on}
                  className={`px-3 py-2 min-h-[40px] rounded-full text-xs font-semibold border transition cursor-pointer ${
                    on
                      ? "bg-blue-950/70 border-blue-600 text-blue-200"
                      : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-white"
                  }`}
                >
                  {rel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 3: your name (optional) */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-neutral-300 block">
            3 · Your name <span className="text-neutral-500 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="e.g. Sarah M., Grandma"
            className="w-full px-3.5 py-2.5 bg-neutral-900 border border-neutral-800 rounded-xl text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500"
          />
          <p className="text-[11px] text-neutral-500 leading-relaxed">
            So the Becks can say thanks — skip if you&apos;d rather not. Other visitors
            never see your name; only the Becks do, in their private admin.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white text-xs font-semibold transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || selected.size === 0}
            className="px-5 py-2 min-h-[40px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold shadow-lg shadow-blue-950/40 transition flex items-center gap-1.5 cursor-pointer"
          >
            <Check size={14} />
            <span>{selected.size === 0 ? "Pick a player first" : "See their photos"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
