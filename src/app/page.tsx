import PublicHomeView from "@/components/PublicHomeView";
import { getPublicSiteConfig, getVisibleAlbums } from "@/lib/r2";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [config, albums] = await Promise.all([
    getPublicSiteConfig(),
    getVisibleAlbums(),
  ]);

  // Distinct visible categories, ordered by most albums first
  const counts = new Map<string, number>();
  for (const a of albums) {
    const c = (a.category || "").trim();
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const categories = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c]) => c);

  return (
    <PublicHomeView albums={albums} config={config} categories={categories} />
  );
}
