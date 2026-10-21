export interface AlbumSummary {
  id: string;
  title: string;
  date: string;
  category?: string;
  sub_category?: string;
  photo_count: number;
  cover_url: string;
  focal_point?: string;
  photos_pool?: string[];
}

/** One player on a team's roster (Phase 1 viewer-identity feature).
 *  Jersey number is the identity anchor; the name is display-only. */
export interface RosterPlayer {
  number: string;
  name?: string;
  active: boolean;
}

/** Rosters keyed by category (team) name, exactly as stored in the config. */
export type RosterMap = Record<string, RosterPlayer[]>;

/** Validate/normalize an unknown value into a RosterMap. Drops malformed
 *  entries; a player with no jersey number is dropped (number is required). */
export function sanitizeRosters(input: unknown): RosterMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: RosterMap = {};
  for (const [cat, list] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const players: RosterPlayer[] = [];
    for (const item of list) {
      const p = (item || {}) as Partial<RosterPlayer>;
      const number = String(p.number ?? "").trim().slice(0, 12);
      if (!number) continue;
      const name = String(p.name ?? "").trim().slice(0, 60);
      players.push({ number, ...(name ? { name } : {}), active: p.active !== false });
    }
    out[cat] = players;
  }
  return out;
}

/**
 * Config for the PUBLIC companion site, stored as site_config_public.json
 * in the shared R2 bucket. The family site keeps using site_config.json.
 */
export interface PublicSiteConfig {
  site_title: string;
  badge_text: string;
  hero_headline: string;
  hero_description: string;
  theme_preset: string;
  /** Categories (case-insensitive) that may appear on the public site.
   *  Albums in any other category stay off the public site entirely. */
  visible_categories: string[];
  /** How many of the most recent albums the homepage showcase shows. */
  latest_count: number;
  /** Canonical category list, managed in /admin. Drives the upload form's
   *  category picker and the admin category manager. */
  categories: string[];
  /** Background-image brightness (0-100) for the splash hero, homepage
   *  mosaic wallpaper, and album page backdrop. Admin-set site-wide defaults. */
  splash_brightness: number;
  mosaic_brightness: number;
  album_backdrop_brightness: number;
  /** Per-field font keys (see src/lib/fonts.ts). "geist" = original look. */
  font_brand: string;
  font_badge: string;
  font_headline: string;
  font_description: string;
  font_ui: string;
  /** Team rosters (Phase 1): category name -> players. Drives the claim
   *  picker and player tagging. Managed in /admin → Site Design. */
  rosters: RosterMap;
}

/** Clamp a brightness value to the 0-100 range, falling back when invalid. */
export function clampBrightness(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Seed categories observed on the original family site. The admin can
 *  rename, add, or remove these freely. */
export const SEED_CATEGORIES = [
  "Corvian HS Basketball",
  "Corvian HS Football",
  "Corvian HS Baseball",
  "Corvian HS Soccer",
  "Corvian MS Soccer",
  "Canes Baseball",
  "More from Beck/Photo",
];

export const DEFAULT_PUBLIC_CONFIG: PublicSiteConfig = {
  site_title: "BECK / PHOTO",
  badge_text: "Sports Action Photography",
  hero_headline: "Game Day Highlights",
  hero_description:
    "Browse recent game albums and download high-resolution photos.",
  theme_preset: "slate-glow",
  // Fail-safe default: nothing is public until the owner picks categories
  // in /admin. This keeps family albums off the public site by default.
  visible_categories: [],
  latest_count: 10,
  categories: [...SEED_CATEGORIES],
  splash_brightness: 80,
  mosaic_brightness: 40,
  album_backdrop_brightness: 25,
  font_brand: "geist",
  font_badge: "geist",
  font_headline: "geist",
  font_description: "geist",
  font_ui: "geist",
  rosters: {},
};

export function isAlbumVisible(
  album: AlbumSummary,
  visibleCategories: string[]
): boolean {
  if (!album.category) return false;
  const cat = album.category.toLowerCase().trim();
  return visibleCategories.some((c) => c.toLowerCase().trim() === cat);
}

export function categorySlug(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
