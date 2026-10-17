"use client";

import Link from "next/link";
import { Folder, Calendar, Layers } from "lucide-react";
import { AlbumSummary } from "@/lib/types";
import { getFocalPointStyle } from "@/lib/imageRandomizer";

export default function AlbumCard({ album }: { album: AlbumSummary }) {
  return (
    <Link
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
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-700">
            <Folder size={40} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {album.category && (
          <span className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 backdrop-blur-md text-blue-300 border border-blue-900/40 font-mono">
            {album.category}
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
  );
}
