"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Folder, Calendar, Layers, Coffee, Share2 } from "lucide-react";
import SupportModal, { FundType } from "@/components/SupportModal";
import ShareSheet from "@/components/ShareSheet";
import { shuffleArray, getFocalPointStyle } from "@/lib/imageRandomizer";

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

interface CategoryGalleryViewProps {
  sportSlug: string;
  sportTitle: string;
  albums: AlbumSummary[];
  fontUiVar?: string;
}

export default function CategoryGalleryView({
  sportSlug,
  sportTitle,
  albums,
  fontUiVar,
}: CategoryGalleryViewProps) {
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [supportFund, setSupportFund] = useState<FundType>("gear");

  // Pool all photos from the category's albums with Fisher-Yates shuffle
  const sportMosaicPhotos = useMemo(() => {
    const pool: string[] = [];
    albums.forEach((a) => {
      if (a.photos_pool && a.photos_pool.length > 0) {
        pool.push(...a.photos_pool);
      } else if (a.cover_url) {
        pool.push(a.cover_url);
      }
    });

    if (pool.length === 0) return [];
    let tiles = shuffleArray(pool);
    while (tiles.length < 24) {
      tiles = [...tiles, ...shuffleArray(pool)];
    }
    return tiles.slice(0, 24);
  }, [albums]);

  const openSupport = (fund: FundType = "gear") => {
    setSupportFund(fund);
    setIsSupportOpen(true);
  };

  return (
    <div
      className="min-h-screen bg-neutral-950 text-neutral-100 pb-20 relative select-none overflow-hidden"
      style={fontUiVar ? { fontFamily: `var(${fontUiVar})` } : undefined}
    >
      {/* Tight-Gap Sport Mosaic Backdrop */}
      {sportMosaicPhotos.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-30 select-none">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 sm:gap-1.5 p-1 -rotate-1 scale-105 filter saturate-75 contrast-110">
            {sportMosaicPhotos.map((url, idx) => (
              <div
                key={`${url}-${idx}`}
                className={`rounded-md overflow-hidden bg-neutral-900 ${
                  idx % 3 === 0
                    ? "aspect-4/3"
                    : idx % 2 === 0
                    ? "aspect-square"
                    : "aspect-3/4"
                }`}
              >
                <img
                  src={url}
                  alt=""
                  className="w-full h-full object-cover"
                  style={getFocalPointStyle()}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vignette Layer */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-radial from-transparent via-neutral-950/50 to-neutral-950" />
      <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-neutral-950/80" />

      <div className="relative z-10">
        <header className="border-b border-neutral-800/80 sticky top-0 z-30 bg-neutral-950/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-400 hover:text-white transition"
            >
              <ArrowLeft size={14} /> Back to Directory
            </Link>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsShareOpen(true)}
                className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-2 px-3 min-h-[40px] rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer shadow-sm"
              >
                <Share2 size={12} className="text-blue-400" />
                <span>SHARE</span>
              </button>

              <button
                onClick={() => openSupport("gear")}
                className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-2 px-3 min-h-[40px] rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer shadow-sm"
              >
                <Coffee size={12} className="text-amber-400" />
                <span className="hidden sm:inline">SUPPORT</span>
              </button>

              <span className="text-xs font-mono text-neutral-500 pl-1">
                {albums.length} {albums.length === 1 ? "ALBUM" : "ALBUMS"}
              </span>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 pt-10 space-y-12">
          <div className="space-y-2 border-b border-neutral-800/80 pb-6">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-400 font-mono block">
              Sport Archive
            </span>
            <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight uppercase">
              {sportTitle}
            </h1>
          </div>

          {/* Album Cards */}
          {albums.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-neutral-800 rounded-2xl">
              <Folder className="mx-auto text-neutral-600 mb-3" size={36} />
              <p className="text-sm font-semibold text-neutral-300">
                No albums found
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {albums.map((album) => (
                <Link
                  key={album.id}
                  href={`/album/${album.id}`}
                  className="group relative rounded-2xl overflow-hidden border border-neutral-800/80 hover:border-blue-500/50 bg-neutral-900/70 hover:bg-neutral-900/95 backdrop-blur-sm transition-all duration-300 flex flex-col shadow-xl hover:shadow-2xl hover:shadow-blue-950/40"
                >
                  <div className="relative aspect-4/3 overflow-hidden bg-neutral-900">
                    {album.cover_url ? (
                      <img
                        src={album.cover_url}
                        alt={album.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                        style={getFocalPointStyle(album.focal_point)}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-neutral-700">
                        <Folder size={40} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                    {album.sub_category && (
                      <span className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 backdrop-blur-md text-blue-300 border border-blue-900/40 font-mono">
                        {album.sub_category}
                      </span>
                    )}

                    <span className="absolute bottom-3 right-3 px-2 py-0.5 rounded text-[10px] font-medium bg-black/60 backdrop-blur-md text-neutral-300 flex items-center gap-1 border border-white/10 font-mono">
                      <Layers size={11} /> {album.photo_count || 0} photos
                    </span>
                  </div>

                  <div className="p-5 space-y-1.5 flex-1 flex flex-col justify-end">
                    <h3 className="text-base font-bold text-white group-hover:text-blue-400 transition leading-snug">
                      {album.title}
                    </h3>
                    {album.date && (
                      <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-mono">
                        <Calendar size={13} />
                        <span>{album.date}</span>
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </main>
      </div>

      <ShareSheet
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        albumTitle={`${sportTitle} Archive`}
        albumId={sportSlug}
        sharePath={`/category/${sportSlug}`}
      />

      <SupportModal
        isOpen={isSupportOpen}
        onClose={() => setIsSupportOpen(false)}
        defaultFund={supportFund}
      />
    </div>
  );
}
