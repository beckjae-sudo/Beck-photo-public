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
}

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
