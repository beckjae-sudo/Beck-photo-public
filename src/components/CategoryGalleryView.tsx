"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Folder, Calendar, Layers, Coffee, Share2 } from "lucide-react";
import SupportModal, { FundType } from "@/components/SupportModal";
import ShareModal from "@/components/ShareModal";
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
}

export default function CategoryGalleryView({
  sportSlug,
  sportTitle,
  albums,
}: CategoryGalleryViewProps) {
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>("All");
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [supportFund, setSupportFund] = useState<FundType>("gear");

  const subCategories = useMemo(() => {
    const set = new Set<string>();
    albums.forEach((a) => {
      if (a.sub_category) {
        set.add(a.sub_category);
      } else {
        const titleLower = a.title.toLowerCase();
        if (titleLower.includes("varsity") || titleLower.includes("high school")) set.add("Varsity");
        else if (titleLower.includes("middle school") || titleLower.includes("ms")) set.add("Middle School");
        else if (titleLower.includes("travel") || titleLower.includes("showcase") || titleLower.includes("club")) set.add("Travel");
      }
    });

    const list = Array.from(set);
    return list.length > 0 ? ["All", ...list] : ["All"];
  }, [albums]);

  const filteredAlbums = useMemo(() => {
    if (selectedSubCategory === "All") return albums;
    return albums.filter((a) => {
      if (a.sub_category) return a.sub_category.toLowerCase() === selectedSubCategory.toLowerCase();
      const titleLower = a.title.toLowerCase();
      if (selectedSubCategory === "Varsity") return titleLower.includes("varsity") || titleLower.includes("high school");
      if (selectedSubCategory === "Middle School") return titleLower.includes("middle school") || titleLower.includes("ms");
      if (selectedSubCategory === "Travel") return titleLower.includes("travel") || titleLower.includes("showcase") || titleLower.includes("club");
      return true;
    });
  }, [albums, selectedSubCategory]);

  // Pool all photos from active subcategory albums with Fisher-Yates shuffle
  const sportMosaicPhotos = useMemo(() => {
    const pool: string[] = [];
    filteredAlbums.forEach((a) => {
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
  }, [filteredAlbums]);

  const getSubCategoryCover = (subCat: string) => {
    if (subCat === "All") return albums[0]?.cover_url || "";
    const match = albums.find((a) => {
      if (a.sub_category) return a.sub_category.toLowerCase() === subCat.toLowerCase();
      const titleLower = a.title.toLowerCase();
      if (subCat === "Varsity") return titleLower.includes("varsity") || titleLower.includes("high school");
      if (subCat === "Middle School") return titleLower.includes("middle school") || titleLower.includes("ms");
      if (subCat === "Travel") return titleLower.includes("travel") || titleLower.includes("showcase") || titleLower.includes("club");
      return false;
    });
    return match ? match.cover_url : albums[0]?.cover_url || "";
  };

  const openSupport = (fund: FundType = "gear") => {
    setSupportFund(fund);
    setIsSupportOpen(true);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 pb-20 relative select-none overflow-hidden">
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
                className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-1.5 px-3 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer shadow-sm"
              >
                <Share2 size={12} className="text-blue-400" />
                <span>SHARE</span>
              </button>

              <button
                onClick={() => openSupport("gear")}
                className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-1.5 px-3 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer shadow-sm"
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

          {/* Sub-Category Portals */}
          {subCategories.length > 1 && (
            <div className="flex flex-col items-center space-y-3">
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                Filter by Program / Level
              </span>

              <div className="flex items-center justify-center gap-6 sm:gap-8 overflow-x-auto py-2 px-4 w-full no-scrollbar">
                {subCategories.map((subCat) => {
                  const isSelected = selectedSubCategory === subCat;
                  const coverUrl = getSubCategoryCover(subCat);

                  return (
                    <button
                      key={subCat}
                      onClick={() => setSelectedSubCategory(subCat)}
                      className="group flex flex-col items-center gap-2.5 transition shrink-0 cursor-pointer"
                    >
                      <div
                        className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full p-[2.5px] transition-all duration-300 shadow-xl ${
                          isSelected
                            ? "bg-gradient-to-b from-blue-500 to-cyan-400 scale-105 shadow-blue-950/60 ring-2 ring-blue-500/50"
                            : "bg-gradient-to-b from-neutral-700 to-neutral-900 group-hover:from-neutral-500 group-hover:to-neutral-700 opacity-75 group-hover:opacity-100"
                        }`}
                      >
                        <div className="w-full h-full rounded-full overflow-hidden bg-neutral-900 relative">
                          {coverUrl ? (
                            <img
                              src={coverUrl}
                              alt={subCat}
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                              style={getFocalPointStyle()}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-600 bg-neutral-900">
                              <Folder size={24} />
                            </div>
                          )}
                          {!isSelected && (
                            <div className="absolute inset-0 bg-black/30 group-hover:bg-transparent transition-colors" />
                          )}
                        </div>
                      </div>

                      <div className="text-center space-y-0.5 max-w-[100px]">
                        <span
                          className={`text-xs font-bold tracking-wider uppercase font-mono block leading-tight ${
                            isSelected ? "text-white underline underline-offset-4" : "text-neutral-400 group-hover:text-neutral-200"
                          }`}
                        >
                          {subCat}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Album Cards */}
          {filteredAlbums.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-neutral-800 rounded-2xl">
              <Folder className="mx-auto text-neutral-600 mb-3" size={36} />
              <p className="text-sm font-semibold text-neutral-300">
                No albums found for {selectedSubCategory}
              </p>
              <button
                onClick={() => setSelectedSubCategory("All")}
                className="mt-3 px-4 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-blue-400 text-xs font-mono transition cursor-pointer"
              >
                View all {sportTitle} albums
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredAlbums.map((album) => (
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

      <ShareModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        albumTitle={`${sportTitle} Archive`}
        albumId={`category/${sportSlug}`}
      />

      <SupportModal
        isOpen={isSupportOpen}
        onClose={() => setIsSupportOpen(false)}
        defaultFund={supportFund}
      />
    </div>
  );
}
