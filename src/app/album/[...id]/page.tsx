import { notFound } from "next/navigation";
import PublicAlbumView from "@/components/PublicAlbumView";
import { getVisibleAlbums } from "@/lib/r2";

export const dynamic = "force-dynamic";

export default async function AlbumPage({
  params,
}: {
  params: Promise<{ id: string[] }>;
}) {
  const resolvedParams = await params;
  const segments = Array.isArray(resolvedParams?.id) ? resolvedParams.id : [];
  // Mirror PublicAlbumView's ID derivation: join nested segments, decoding each.
  const albumId = segments
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");

  // Privacy gate: only albums in this site's public index AND in a visible
  // category may be viewed here. The bucket is shared with the family site,
  // so without this check any family album would render by direct URL.
  // Anything not listed gets the generic not-found (no existence oracle),
  // exactly like the category page.
  const visibleAlbums = await getVisibleAlbums();
  if (!albumId || !visibleAlbums.some((a) => a.id === albumId)) {
    notFound();
  }

  return <PublicAlbumView />;
}
