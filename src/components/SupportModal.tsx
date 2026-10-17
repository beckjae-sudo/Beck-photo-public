"use client";

import { useState, useEffect } from "react";
import { X, ExternalLink, HardDrive, Sparkles, Heart, Check, Copy } from "lucide-react";

export type FundType = "gear" | "jaden";

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultFund?: FundType;
}

interface FundDetails {
  id: FundType;
  title: string;
  tagline: string;
  handle: string;
  description: string;
  icon: any;
  note: string;
  badge: string;
}

const FUNDS: Record<FundType, FundDetails> = {
  gear: {
    id: "gear",
    title: "The Gear & Storage Fund",
    tagline: "Site & Equipment Reinvestment",
    handle: "Jae-Beck-1",
    note: "Gear & Storage Fund",
    badge: "SITE REINVESTMENT",
    description: "Keeps the servers running and helps fund fast SD cards, lens cleaning, and camera maintenance.",
    icon: HardDrive,
  },
  jaden: {
    id: "jaden",
    title: "The Student Creator Fund",
    tagline: "Jaden Beck — Photography & Media",
    handle: "ShotByJaden2",
    note: "Jaden Creator Fund",
    badge: "STUDENT CREATOR",
    description: "Direct support for Jaden's time behind the lens, editing sideline action, and high school creative projects.",
    icon: Sparkles,
  },
};

export default function SupportModal({ isOpen, onClose, defaultFund = "gear" }: SupportModalProps) {
  const [selectedFund, setSelectedFund] = useState<FundType>(defaultFund);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedFund(defaultFund);
      setCopied(false);
    }
  }, [isOpen, defaultFund]);

  if (!isOpen) return null;

  const current = FUNDS[selectedFund] || FUNDS["gear"];
  const venmoWebUrl = `https://venmo.com/u/${current.handle}?txn=pay&note=${encodeURIComponent(current.note)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(venmoWebUrl)}`;

  const copyHandle = () => {
    navigator.clipboard.writeText(`@${current.handle}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-neutral-800/80 flex items-center justify-between bg-neutral-900/40">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-amber-400">
              <Heart size={15} fill="currentColor" />
            </span>
            <div>
              <h2 className="text-sm font-black tracking-tight text-white uppercase font-mono">
                Sideline Support // Funds
              </h2>
              <p className="text-[11px] text-neutral-400 font-mono">
                100% optional community appreciation
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* 2 Fund Selector Tabs */}
        <div className="grid grid-cols-2 border-b border-neutral-800 bg-neutral-900/20 text-xs font-mono">
          {(Object.keys(FUNDS) as FundType[]).map((fundKey) => {
            const f = FUNDS[fundKey];
            const Icon = f.icon;
            const isActive = selectedFund === fundKey;
            return (
              <button
                key={fundKey}
                onClick={() => {
                  setSelectedFund(fundKey);
                  setCopied(false);
                }}
                className={`flex items-center justify-center gap-2 py-3 px-3 transition border-b-2 text-center cursor-pointer ${
                  isActive
                    ? "border-blue-500 bg-neutral-800/60 text-white font-bold"
                    : "border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/40"
                }`}
              >
                <Icon size={14} className={isActive ? "text-blue-400" : "text-neutral-500"} />
                <span className="truncate">{f.title}</span>
              </button>
            );
          })}
        </div>

        {/* Fund Detail Card */}
        <div className="p-6 space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-block px-2 py-0.5 rounded text-[9px] font-mono font-bold tracking-widest bg-blue-950 text-blue-300 border border-blue-800 uppercase">
                {current.badge}
              </div>
              <h3 className="text-base font-bold text-white">{current.title}</h3>
              <p className="text-xs text-neutral-400">{current.tagline}</p>
            </div>

            <button
              onClick={copyHandle}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-xs font-mono text-neutral-300 hover:text-white transition cursor-pointer"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>@{current.handle}</span>
            </button>
          </div>

          <p className="text-xs text-neutral-300 leading-relaxed bg-neutral-900/60 border border-neutral-800/80 p-3.5 rounded-xl font-sans">
            &quot;{current.description}&quot;
          </p>

          {/* Payment Action Container */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center bg-neutral-900/30 border border-neutral-800/80 p-4 rounded-xl">
            {/* Desktop High-Contrast QR Display */}
            <div className="flex flex-col items-center justify-center p-3.5 bg-white rounded-xl shadow-inner space-y-2">
              <img
                src={qrUrl}
                alt={`Venmo QR for @${current.handle}`}
                className="w-32 h-32 object-contain"
              />
              <span className="text-[10px] text-neutral-700 font-mono font-semibold">
                Scan with Phone Camera
              </span>
            </div>

            {/* Mobile / Direct Link */}
            <div className="space-y-3 flex flex-col justify-center">
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider block">
                  Direct Link / Mobile
                </span>
                <p className="text-xs text-neutral-300">
                  Opens Venmo with recipient &amp; note pre-filled.
                </p>
              </div>

              <a
                href={venmoWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-blue-950/40"
              >
                <span>Pay with Venmo</span>
                <ExternalLink size={13} />
              </a>

              <p className="text-[10px] text-neutral-500 text-center font-mono">
                Pre-filled note: &quot;{current.note}&quot;
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-neutral-950 border-t border-neutral-900 text-center">
          <p className="text-[10px] font-mono text-neutral-500 tracking-wider uppercase">
            Beck / Photo — Unrestricted Free Public Access
          </p>
        </div>
      </div>
    </div>
  );
}
