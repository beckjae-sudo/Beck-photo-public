import LatestView from "@/components/LatestView";
import { getPublicSiteConfig, getVisibleAlbums } from "@/lib/r2";

export const dynamic = "force-dynamic";

export default async function LatestPage() {
  const [config, albums] = await Promise.all([
    getPublicSiteConfig(),
    getVisibleAlbums(),
  ]);

  const latest = albums.slice(0, config.latest_count);

  return <LatestView albums={latest} config={config} />;
}
