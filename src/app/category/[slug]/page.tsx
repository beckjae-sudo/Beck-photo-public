import { notFound } from "next/navigation";
import CategoryGalleryView, { AlbumSummary } from "@/components/CategoryGalleryView";
import { getPublicSiteConfig, getVisibleAlbums, getPublicBaseUrl } from "@/lib/r2";
import { categorySlug } from "@/lib/types";
import { fontVariableFor } from "@/lib/fonts";

export const dynamic = "force-dynamic";

function matchesSlug(
  album: AlbumSummary,
  slug: string,
  visibleCategories: string[]
): boolean {
  const cat = (album.category || "").toLowerCase();
  const title = (album.title || "").toLowerCase();
  const catSlug = categorySlug(album.category || "");

  // Only match against categories that are visible on the public site
  const visibleSlugs = new Set(visibleCategories.map(categorySlug));
  if (catSlug && !visibleSlugs.has(catSlug)) return false;

  if (catSlug === slug) return true;
  if (slug === "basketball" && (cat.includes("basketball") || title.includes("basketball") || title.includes("hoops"))) return true;
  if (slug === "baseball" && (cat.includes("baseball") || title.includes("baseball") || title.includes("diamond"))) return true;
  if (slug === "football" && (cat.includes("football") || title.includes("football") || title.includes("gridiron"))) return true;
  if (slug === "soccer" && (cat.includes("soccer") || title.includes("soccer") || title.includes("fc"))) return true;

  return cat.includes(slug) || title.includes(slug);
}

function titleForSlug(slug: string, albums: AlbumSummary[]): string {
  if (slug === "baseball") return "Baseball";
  if (slug === "basketball") return "Basketball";
  if (slug === "football") return "Football";
  if (slug === "soccer") return "Soccer";
  return (
    albums[0]?.category ||
    slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = await params;
  const slug = decodeURIComponent(resolvedParams?.slug || "").toLowerCase().trim();

  const [config, albums] = await Promise.all([
    getPublicSiteConfig(),
    getVisibleAlbums(),
  ]);

  const matched = albums.filter((a) =>
    matchesSlug(a, slug, config.visible_categories)
  );

  // Hide non-public categories behind a generic not-found (no existence oracle)
  if (matched.length === 0) notFound();

  // Pool individual game photos from each album manifest (parallel)
  const baseUrl = getPublicBaseUrl();
  const enrichedAlbums = await Promise.all(
    matched.map(async (album) => {
      try {
        const manifestRes = await fetch(`${baseUrl}/${album.id}/manifest.json`, {
          cache: "no-store",
        });
        if (manifestRes.ok) {
          const manifestData = await manifestRes.json();
          const photoUrls = (manifestData.photos || []).map(
            (p: { urls?: { display?: string; thumb?: string } }) =>
              p.urls?.display || p.urls?.thumb
          );
          return { ...album, photos_pool: photoUrls };
        }
      } catch {
        // fall through to cover-only pool
      }
      return {
        ...album,
        photos_pool: album.cover_url ? [album.cover_url] : [],
      };
    })
  );

  return (
    <CategoryGalleryView
      sportSlug={slug}
      sportTitle={titleForSlug(slug, matched)}
      albums={enrichedAlbums}
      fontUiVar={fontVariableFor(config.font_ui)}
    />
  );
}
