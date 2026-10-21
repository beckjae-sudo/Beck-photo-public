import { RosterMap, RosterPlayer } from "./types";

/**
 * Phase 1 claimed-identity helpers.
 *
 * A "player key" is the stable identifier used by claims and photo tags:
 *   "<Category>::<jersey number>"        — a roster player, e.g. "Corvian HS Soccer::12"
 *   "<Category>::free:<entered text>"    — a no-roster free-text claim
 * Keys are category-scoped because jersey numbers only mean something
 * within a team. Category matching is always case-insensitive.
 */

export interface VisitorClaim {
  playerKey: string;
  category: string;
  relation: string | null;
}

export const CLAIM_RELATIONS = ["Parent", "Family", "Fan", "That's me"] as const;

export function playerKeyFor(category: string, number: string): string {
  return `${String(category || "").trim()}::${String(number || "").trim()}`;
}

export function freePlayerKey(category: string, text: string): string {
  return `${String(category || "").trim()}::free:${String(text || "").trim()}`;
}

export interface ParsedPlayerKey {
  category: string;
  number: string | null;
  freeText: string | null;
}

export function parsePlayerKey(key: string): ParsedPlayerKey {
  const raw = String(key || "");
  const sep = raw.indexOf("::");
  if (sep < 0) return { category: "", number: null, freeText: raw || null };
  const category = raw.slice(0, sep);
  const rest = raw.slice(sep + 2);
  if (rest.startsWith("free:")) {
    return { category, number: null, freeText: rest.slice(5) };
  }
  return { category, number: rest, freeText: null };
}

/** The roster stored for a category (case-insensitive category match). */
export function rosterForCategory(
  rosters: RosterMap | undefined,
  category: string
): RosterPlayer[] {
  if (!rosters || !category) return [];
  const target = category.trim().toLowerCase();
  for (const [cat, list] of Object.entries(rosters)) {
    if (cat.trim().toLowerCase() === target) return Array.isArray(list) ? list : [];
  }
  return [];
}

export function rosterPlayerLabel(p: RosterPlayer): string {
  return p.name ? `#${p.number} — ${p.name}` : `#${p.number}`;
}

/**
 * Human label for any player key, resolving against rosters when possible.
 * Roster-removed players are labeled "(former roster)" per spec §2;
 * free-text keys show exactly what the visitor entered.
 */
export function playerKeyLabel(key: string, rosters?: RosterMap): string {
  const parsed = parsePlayerKey(key);
  if (parsed.freeText) return parsed.freeText;
  if (parsed.number !== null) {
    const roster = rosterForCategory(rosters, parsed.category);
    const found = roster.find((p) => p.number === parsed.number);
    if (found) return rosterPlayerLabel(found);
    return `#${parsed.number} (former roster)`;
  }
  return key;
}

export interface PlayerOption {
  key: string;
  label: string;
  isClaimed: boolean;
}

/**
 * Options for tag/claim pickers in one category: the visitor's claimed
 * players first (spec §3), then the active roster, deduped by key.
 */
export function buildPlayerOptions(
  category: string,
  rosters: RosterMap | undefined,
  claims: VisitorClaim[]
): PlayerOption[] {
  const out: PlayerOption[] = [];
  const seen = new Set<string>();
  const catKey = String(category || "").trim().toLowerCase();

  for (const c of claims || []) {
    if (String(c.category || "").trim().toLowerCase() !== catKey) continue;
    if (seen.has(c.playerKey)) continue;
    seen.add(c.playerKey);
    out.push({ key: c.playerKey, label: playerKeyLabel(c.playerKey, rosters), isClaimed: true });
  }

  for (const p of rosterForCategory(rosters, category)) {
    if (!p.active) continue;
    const key = playerKeyFor(category, p.number);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: rosterPlayerLabel(p), isClaimed: false });
  }

  return out;
}
