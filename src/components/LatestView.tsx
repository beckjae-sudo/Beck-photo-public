"use client";

import { useState } from "react";
import Link from "next/link";
import { Coffee, Sparkles, ArrowLeft } from "lucide-react";
import SupportModal, { FundType } from "@/components/SupportModal";
import AlbumCard from "@/components/AlbumCard";
import { AlbumSummary, PublicSiteConfig } from "@/lib/types";

export default function LatestView({
  albums,
  config,
}: {
  albums: AlbumSummary[];
  config: PublicSiteConfig;
}) {
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [supportFund, setSupportFund] = useState<FundType>("gear");

  const openSupport = (fund: FundType = "gear") => {
    setSupportFund(fund);
    setIsSupportOpen(true);
  };

  return (
    <div className="relative min-h-screen bg-neutral-950 text-neutral-100 select-none flex flex-col">
      <header className="border-b border-neutral-800/60 sticky top-0 z-30 bg-neutral-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-xs font-mono text-neutral-400 hover:text-white transition"
              title="Back to full gallery"
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline">GALLERY</span>
            </Link>
            <Link
              href="/"
              className="font-black text-sm tracking-tighter uppercase text-white flex items-center gap-1 hover:opacity-80 transition"
            >
              <span>BECK</span>
              <span className="text-blue-500 font-light">/</span>
              <span>PHOTO</span>
            </Link>
          </div>

          <button
            onClick={() => openSupport("gear")}
            className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-1.5 px-3 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer"
          >
            <Coffee size={12} className="text-amber-400" />
            <span className="hidden sm:inline">SUPPORT // FUNDS</span>
            <span className="sm:hidden">SUPPORT</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-10 pb-16 space-y-8 w-full">
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-blue-400 font-mono border border-blue-900/50 bg-blue-950/30 rounded-full px-4 py-1.5">
            <Sparkles size={12} />
            Latest uploads
          </p>
          <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white">
            Fresh from the sidelines
          </h1>
          <p className="text-sm text-neutral-400">
            The {albums.length} most recent {albums.length === 1 ? "gallery" : "galleries"}
            {config.badge_text ? ` — ${config.badge_text}` : ""}. Share this page
            to share just the new stuff.
          </p>
        </div>

        {albums.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/50 p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-neutral-200 font-mono uppercase tracking-wider">
              No public uploads yet
            </p>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              Nothing has been shared publicly yet. Check back soon, or browse
              the <Link href="/" className="text-blue-400 hover:text-blue-300">full gallery</Link>.
            </p>
          </div>
        )}
      </main>

      <footer className="border-t border-neutral-900 bg-neutral-950/80 backdrop-blur-md mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-500 font-mono">
          <div>
            <span>
              {config.site_title} &copy; {new Date().getFullYear()}
            </span>
          </div>
          <Link href="/" className="hover:text-neutral-300 transition">
            Full gallery
          </Link>
        </div>
      </footer>

      <SupportModal
        isOpen={isSupportOpen}
        onClose={() => setIsSupportOpen(false)}
        defaultFund={supportFund}
      />
    </div>
  );
}
