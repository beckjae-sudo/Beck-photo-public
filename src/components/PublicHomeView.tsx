"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Coffee, LayoutGrid } from "lucide-react";
import SupportModal, { FundType } from "@/components/SupportModal";
import AlbumCard from "@/components/AlbumCard";
import { AlbumSummary, PublicSiteConfig, categorySlug } from "@/lib/types";
import { shuffleArray, getFocalPointStyle } from "@/lib/imageRandomizer";

const INSTAGRAM_HANDLE = "shot.by.jaden2";
const INSTAGRAM_URL = `https://instagram.com/${INSTAGRAM_HANDLE}`;
const SPLASH_SEEN_KEY = "beck_public_entered_gallery";

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
      <rect width={20} height={20} x={2} y={2} rx={5} ry={5} />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

function getHighResCoverUrl(url: string): string {
  if (!url) return "";
  return url
    .replace(/\/thumb\//, "/display/")
    .replace(/_thumb\./, "_display.")
    .replace(/thumb/g, "display");
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
  const [showSplash, setShowSplash] = useState(true);
  const [currentCoverIndex, setCurrentCoverIndex] = useState(0);
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [supportFund, setSupportFund] = useState<FundType>("gear");

  const openSupport = (fund: FundType = "gear") => {
    setSupportFund(fund);
    setIsSupportOpen(true);
  };

  // Skip splash on return visits within the session
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SPLASH_SEEN_KEY) === "true") {
        setShowSplash(false);
      }
    } catch {
      // sessionStorage unavailable — show splash
    }
  }, []);

  // Splash carousel photos (high-res covers, shuffled client-side)
  const baseSplashPhotos = useMemo(() => {
    return albums
      .filter((a) => Boolean(a.cover_url))
      .map((a) => ({
        url: getHighResCoverUrl(a.cover_url),
        focal_point: a.focal_point,
      }));
  }, [albums]);

  const [splashPhotos, setSplashPhotos] = useState(baseSplashPhotos);
  useEffect(() => {
    if (baseSplashPhotos.length > 0) {
      setSplashPhotos(shuffleArray(baseSplashPhotos));
    }
  }, [baseSplashPhotos]);

  useEffect(() => {
    if (!showSplash || splashPhotos.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentCoverIndex((prev) => (prev + 1) % splashPhotos.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [showSplash, splashPhotos.length]);

  const handleEnterGallery = () => {
    setShowSplash(false);
    try {
      sessionStorage.setItem(SPLASH_SEEN_KEY, "true");
    } catch {
      // ignore
    }
  };

  const handleReturnToSplash = () => {
    setShowSplash(true);
    try {
      sessionStorage.removeItem(SPLASH_SEEN_KEY);
    } catch {
      // ignore
    }
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

  const latestCount =
    config.latest_count > 0 ? Math.min(50, Math.floor(config.latest_count)) : 3;
  const latestAlbums = albums.slice(0, latestCount);

  // Per-category album counts, memoized (pill bar can hold many categories)
  const albumCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of albums) {
      const key = (a.category || "").toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [albums]);
  const albumCountFor = (cat: string) => albumCounts.get(cat.toLowerCase()) || 0;

  return (
    <div className="relative min-h-screen bg-black text-neutral-100 overflow-x-hidden select-none">
      {/* ----------------- SPLASH SCREEN ----------------- */}
      {showSplash && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-between p-8 md:p-14 bg-black overflow-hidden">
          {splashPhotos.length > 0 ? (
            splashPhotos.map((item, idx) => (
              <div
                key={`${item.url}-${idx}`}
                className="absolute inset-0 transition-opacity duration-1000 ease-in-out pointer-events-none"
                style={{ opacity: idx === currentCoverIndex ? 0.8 : 0 }}
              >
                <img
                  src={item.url}
                  alt=""
                  aria-hidden="true"
                  className="w-full h-full object-cover"
                  style={getFocalPointStyle(item.focal_point)}
                  loading={idx === 0 ? "eager" : "lazy"}
                />
              </div>
            ))
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-neutral-950 via-black to-neutral-900 opacity-90" />
          )}

          <div className="absolute inset-0 bg-radial from-transparent via-black/40 to-black/90 pointer-events-none" />
          <div className="absolute inset-0 bg-black/30 pointer-events-none" />

          {/* Top bar */}
          <div className="relative z-10 w-full flex justify-between items-center max-w-7xl mx-auto text-[11px] font-mono tracking-[0.25em] text-neutral-300 uppercase drop-shadow-md">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              ARCHIVE / VOL. 01
            </span>
            <span>{albums.length} GALLERIES</span>
          </div>

          {/* Center brand */}
          <div className="relative z-10 text-center space-y-7 max-w-3xl mx-auto flex flex-col items-center">
            <div className="space-y-3">
              <h1 className="text-5xl sm:text-7xl md:text-8xl font-black uppercase tracking-[-0.07em] text-white flex items-center justify-center gap-2 drop-shadow-2xl">
                <span className="bg-clip-text text-transparent bg-gradient-to-b from-white via-neutral-100 to-neutral-300">
                  BECK
                </span>
                <span className="text-blue-500 font-light tracking-normal transform -skew-x-12">
                  /
                </span>
                <span className="bg-clip-text text-transparent bg-gradient-to-b from-white via-neutral-100 to-neutral-400">
                  PHOTO
                </span>
              </h1>
              <p className="text-[11px] sm:text-xs uppercase tracking-[0.45em] text-neutral-200 font-mono font-medium drop-shadow-md">
                {config.badge_text || "Action & High-Resolution Athletics"}
              </p>
            </div>

            <div className="flex flex-col items-center gap-4">
              <button
                onClick={handleEnterGallery}
                className="group relative flex items-center gap-3 px-8 py-3.5 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/25 text-white text-xs font-semibold tracking-widest uppercase backdrop-blur-xl border border-white/25 hover:border-white/40 shadow-[0_8px_32px_0_rgba(0,0,0,0.5),inset_0_1px_1px_0_rgba(255,255,255,0.4)] transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer"
              >
                <span>Enter Gallery</span>
                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform text-blue-400" />
              </button>

              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 hover:border-white/35 text-[11px] text-neutral-200 hover:text-white transition-all duration-300 hover:scale-[1.02] shadow-lg group"
              >
                <InstagramIcon size={13} className="text-pink-400 group-hover:scale-110 transition-transform" />
                <span>
                  Follow more of Jaden Beck&apos;s work{" "}
                  <span className="font-semibold text-white group-hover:underline">@{INSTAGRAM_HANDLE}</span>
                </span>
              </a>
            </div>
          </div>

          <div className="relative z-10 text-[10px] text-neutral-400 font-mono tracking-[0.2em] uppercase drop-shadow-md">
            Direct Cloudflare R2 Delivery
          </div>
        </div>
      )}

      {/* ----------------- DIRECTORY VIEW ----------------- */}
      <div className="min-h-screen bg-neutral-950 relative flex flex-col justify-between overflow-hidden">
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
              <button
                onClick={handleReturnToSplash}
                className="font-black text-sm tracking-tighter uppercase text-white flex items-center gap-1 hover:opacity-80 transition cursor-pointer"
                title="Return to Splash Screen"
                aria-label="Return to splash screen"
              >
                <span>BECK</span>
                <span className="text-blue-500 font-light">/</span>
                <span>PHOTO</span>
              </button>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => openSupport("gear")}
                  className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-2 px-3 min-h-[40px] rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer"
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
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-6 px-6 no-scrollbar">
                  {categories.map((cat) => (
                    <Link
                      key={cat}
                      href={`/category/${categorySlug(cat)}`}
                      className="shrink-0 flex items-center gap-2 px-4 min-h-[44px] rounded-full bg-neutral-900/80 border border-neutral-800 hover:border-blue-500/60 hover:bg-neutral-800/90 transition group"
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

            {/* Latest albums showcase */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
                <span className="text-xs font-mono tracking-widest text-neutral-400 uppercase">
                  Latest Albums
                </span>
                <span className="text-[11px] font-mono text-neutral-500">
                  Showing {latestAlbums.length} of {albums.length}
                </span>
              </div>

              {latestAlbums.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {latestAlbums.map((album) => (
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
    </div>
  );
}
