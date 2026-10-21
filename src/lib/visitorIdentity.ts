import { VisitorClaim } from "./players";

export interface VisitorProfile {
  id: string;
  name: string | null;
  avatarAnimal: string;
  avatarEmoji: string;
  avatarColor: string;
  isCustomName: boolean;
  /** Phase 1 claimed players (opt-in). Absent/empty = unclaimed mascot,
   *  exactly the pre-Phase-1 experience. */
  claims?: VisitorClaim[];
}

const ANIMALS = [
  { name: "Falcon", emoji: "⚡", color: "from-blue-600 to-indigo-600 border-blue-400/40 text-blue-300" },
  { name: "Panther", emoji: "🐾", color: "from-purple-600 to-violet-600 border-purple-400/40 text-purple-300" },
  { name: "Hawk", emoji: "🦅", color: "from-amber-600 to-orange-600 border-amber-400/40 text-amber-300" },
  { name: "Wolf", emoji: "🐺", color: "from-slate-600 to-zinc-600 border-slate-400/40 text-slate-300" },
  { name: "Cougar", emoji: "🐆", color: "from-rose-600 to-pink-600 border-rose-400/40 text-rose-300" },
  { name: "Mustang", emoji: "🐎", color: "from-emerald-600 to-teal-600 border-emerald-400/40 text-emerald-300" },
  { name: "Eagle", emoji: "🔥", color: "from-cyan-600 to-blue-600 border-cyan-400/40 text-cyan-300" },
  { name: "Bear", emoji: "🐻", color: "from-amber-700 to-yellow-600 border-amber-500/40 text-amber-200" },
];

export function getOrCreateVisitorProfile(): VisitorProfile {
  if (typeof window === "undefined") {
    return {
      id: "guest",
      name: null,
      avatarAnimal: "Falcon",
      avatarEmoji: "⚡",
      avatarColor: ANIMALS[0].color,
      isCustomName: false,
    };
  }

  const stored = localStorage.getItem("beck_visitor_profile");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return { claims: [], ...parsed };
    } catch {}
  }

  // Generate randomized default mascot identity
  const randomAnimal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const randomId = "vis_" + Math.random().toString(36).substring(2, 10);

  const newProfile: VisitorProfile = {
    id: randomId,
    name: null,
    avatarAnimal: randomAnimal.name,
    avatarEmoji: randomAnimal.emoji,
    avatarColor: randomAnimal.color,
    isCustomName: false,
    claims: [],
  };

  localStorage.setItem("beck_visitor_profile", JSON.stringify(newProfile));
  return newProfile;
}

/** Persist a profile and notify any mounted components (badge, album view)
 *  so every surface reflects a claim/name change immediately. */
export function saveVisitorProfile(profile: VisitorProfile): VisitorProfile {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("beck_visitor_profile", JSON.stringify(profile));
    } catch {}
    window.dispatchEvent(
      new CustomEvent<VisitorProfile>("bpp:profile", { detail: profile })
    );
  }
  return profile;
}

/** Subscribe to profile changes made anywhere on the page. Returns an
 *  unsubscribe function. */
export function onVisitorProfileChange(
  cb: (profile: VisitorProfile) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<VisitorProfile>).detail;
    if (detail) cb(detail);
  };
  window.addEventListener("bpp:profile", handler);
  return () => window.removeEventListener("bpp:profile", handler);
}

export function updateVisitorName(customName: string): VisitorProfile {
  const current = getOrCreateVisitorProfile();
  const trimmed = customName.trim();

  const updated: VisitorProfile = {
    ...current,
    name: trimmed ? trimmed : null,
    isCustomName: Boolean(trimmed),
  };

  return saveVisitorProfile(updated);
}

/** Replace the visitor's claims for ONE category, keeping claims made in
 *  other categories untouched (multi-team families, siblings). */
export function setVisitorClaimsForCategory(
  category: string,
  claims: VisitorClaim[]
): VisitorProfile {
  const current = getOrCreateVisitorProfile();
  const catKey = String(category || "").trim().toLowerCase();
  const kept = (current.claims || []).filter(
    (c) => String(c.category || "").trim().toLowerCase() !== catKey
  );
  return saveVisitorProfile({ ...current, claims: [...kept, ...claims] });
}

/** Remove a single claim by player key (any category). */
export function removeVisitorClaim(playerKey: string): VisitorProfile {
  const current = getOrCreateVisitorProfile();
  const claims = (current.claims || []).filter((c) => c.playerKey !== playerKey);
  return saveVisitorProfile({ ...current, claims });
}
