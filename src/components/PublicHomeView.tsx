"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Coffee, Sparkles, LayoutGrid } from "lucide-react";
import SupportModal, { FundType } from "@/components/SupportModal";
import AlbumCard from "@/components/AlbumCard";
import { AlbumSummary, PublicSiteConfig, categorySlug } from "@/lib/types";
import { shuffleArray, getFocalPointStyle } from "@/lib/imageRandomizer";

const INSTAGRAM_HANDLE = "shot.by.jaden2";
const INSTAGRAM_URL = `https://instagram.com/${INSTAGRAM_HANDLE}`;

function InstagramIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

export default function PublicHomeView({
  albums = [],
  config,
  categories,
}: {
  albums: AlbumSummary[];
  config: PublicSiteConfig;
  categories: string[];
}) {
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [supportFund, setSupportFund] = useState<FundType>("gear");

  const openSupport = (fund: FundType = "gear") => {
    setSupportFund(fund);
    setIsSupportOpen(true);
  };

  // Mosaic background: deterministic base, shuffled once on the client
  const baseMosaicPhotos = useMemo(() => {
    const covers = albums
      .filter((a) => Boolean(a.cover_url))
      .map((a) => ({ url: a.cover_url, focal_point: a.focal_point }));
    if (covers.length === 0) return [];
    let tiles = [...covers];
    while (tiles.length < 24) tiles = [...tiles, ...covers];
    return tiles.slice(0, 24);
  }, [albums]);

  const [mosaicPhotos, setMosaicPhotos] = useState(baseMosaicPhotos);
  useEffect(() => {
    setMosaicPhotos(shuffleArray(baseMosaicPhotos));
  }, [baseMosaicPhotos]);

  const recentAlbums = albums.slice(0, 6);
  const albumCountFor = (cat: string) =>
    albums.filter((a) => a.category?.toLowerCase() === cat.toLowerCase()).length;

  return (
    <div className="relative min-h-screen bg-neutral-950 text-neutral-100 overflow-x-hidden select-none flex flex-col">
      {/* Mosaic backdrop */}
      {mosaicPhotos.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-30">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 sm:gap-1.5 p-1 -rotate-1 scale-105 filter saturate-75 contrast-110">
            {mosaicPhotos.map((item, idx) => (
              <div
                key={`${item.url}-${idx}`}
                className={`rounded-xl overflow-hidden bg-neutral-900 border border-white/5 ${
                  idx % 3 === 0 ? "aspect-4/3" : idx % 2 === 0 ? "aspect-square" : "aspect-3/4"
                }`}
              >
                <img
                  src={item.url}
                  alt=""
                  className="w-full h-full object-cover"
                  style={getFocalPointStyle(item.focal_point)}
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="pointer-events-none fixed inset-0 z-0 bg-radial from-transparent via-neutral-950/40 to-neutral-950/90" />
      <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-t from-neutral-950 via-transparent to-neutral-950/80" />

      <div className="relative z-10 flex flex-col min-h-screen">
        <header className="border-b border-neutral-800/60 sticky top-0 z-30 bg-neutral-950/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link
              href="/"
              className="font-black text-sm tracking-tighter uppercase text-white flex items-center gap-1 hover:opacity-80 transition"
            >
              <span>BECK</span>
              <span className="text-blue-500 font-light">/</span>
              <span>PHOTO</span>
            </Link>

            <div className="flex items-center gap-3">
              <Link
                href="/latest"
                className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-1.5 px-3 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700"
                title="Newest uploads only"
              >
                <Sparkles size={12} className="text-blue-400" />
                <span className="hidden sm:inline">LATEST UPLOADS</span>
                <span className="sm:hidden">LATEST</span>
              </Link>

              <button
                onClick={() => openSupport("gear")}
                className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-1.5 px-3 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer"
                title="Sideline Support & Gear Funds"
              >
                <Coffee size={12} className="text-amber-400" />
                <span className="hidden sm:inline">SUPPORT // FUNDS</span>
                <span className="sm:hidden">SUPPORT</span>
              </button>

              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:flex items-center gap-1.5 text-xs font-mono text-neutral-400 hover:text-white transition py-1.5 px-2.5 rounded-lg hover:bg-neutral-900 border border-transparent hover:border-neutral-800"
                title="Follow Jaden Beck on Instagram"
              >
                <InstagramIcon size={12} className="text-neutral-400" />
                <span>@{INSTAGRAM_HANDLE}</span>
              </a>

              <span className="text-xs font-mono text-neutral-500 pl-1">
                {albums.length} GALLERIES
              </span>
            </div>
          </div>
        </header>

        <main className="relative max-w-7xl mx-auto px-6 pt-10 pb-16 space-y-12 w-full">
          {/* Hero */}
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.45em] text-neutral-400 font-mono">
              {config.badge_text}
            </p>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight text-white">
              {config.hero_headline}
            </h1>
            <p className="text-sm sm:text-base text-neutral-400 max-w-xl mx-auto">
              {config.hero_description}
            </p>
          </div>

          {/* Category pill bar — scales to any number of categories */}
          {categories.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-mono tracking-widest text-neutral-500 uppercase">
                <LayoutGrid size={13} />
                <span>Browse by category</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-6 px-6">
                {categories.map((cat) => (
                  <Link
                    key={cat}
                    href={`/category/${categorySlug(cat)}`}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-full bg-neutral-900/80 border border-neutral-800 hover:border-blue-500/60 hover:bg-neutral-800/90 transition group"
                    title={`${albumCountFor(cat)} albums`}
                  >
                    <span className="text-xs font-semibold text-neutral-200 group-hover:text-white uppercase tracking-wider font-mono whitespace-nowrap">
                      {cat}
                    </span>
                    <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950/80 px-1.5 py-0.5 rounded-full">
                      {albumCountFor(cat)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Recent albums */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
              <span className="text-xs font-mono tracking-widest text-neutral-400 uppercase">
                Recent Albums
              </span>
              <Link
                href="/latest"
                className="text-[11px] font-mono text-blue-400 hover:text-blue-300 transition"
              >
                View all latest &rarr;
              </Link>
            </div>

            {recentAlbums.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {recentAlbums.map((album) => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/50 p-10 text-center space-y-2">
                <p className="text-sm font-semibold text-neutral-200 font-mono uppercase tracking-wider">
                  Galleries coming soon
                </p>
                <p className="text-xs text-neutral-500 max-w-md mx-auto">
                  The public gallery list has not been configured yet. The site
                  owner can choose which categories to share in the admin panel.
                </p>
              </div>
            )}
          </div>
        </main>

        <footer className="border-t border-neutral-900 bg-neutral-950/80 backdrop-blur-md mt-auto">
          <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500 font-mono">
            <div>
              <span>
                {config.site_title} &copy; {new Date().getFullYear()}
              </span>
            </div>
            <div className="flex items-center gap-6">
              <Link href="/latest" className="hover:text-neutral-300 transition">
                Latest uploads
              </Link>
              <button
                onClick={() => openSupport("gear")}
                className="hover:text-neutral-300 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Coffee size={13} className="text-amber-400" />
                <span>SUPPORT // FUNDS</span>
              </button>
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-neutral-300 transition flex items-center gap-1.5"
              >
                <InstagramIcon size={13} />
                <span>@{INSTAGRAM_HANDLE}</span>
              </a>
            </div>
          </div>
        </footer>
      </div>

      <SupportModal
        isOpen={isSupportOpen}
        onClose={() => setIsSupportOpen(false)}
        defaultFund={supportFund}
      />
    </div>
  );
}
