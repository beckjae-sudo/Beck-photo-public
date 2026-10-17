"use client";

import { useState, useEffect } from "react";
import { X, Copy, Check, QrCode, Share2, MessageCircle, Mail, UserPlus } from "lucide-react";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  albumTitle: string;
  albumId: string;
}

export default function ShareModal({ isOpen, onClose, albumTitle, albumId }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [shareUrl, setShareUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const base = window.location.origin;
      const url = recipientName.trim()
        ? `${base}/album/${albumId}?v=${encodeURIComponent(recipientName.trim())}`
        : `${base}/album/${albumId}`;
      setShareUrl(url);
    }
  }, [albumId, recipientName, isOpen]);

  if (!isOpen) return null;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(
    shareUrl
  )}&bgcolor=18-18-1b&color=255-255-255&margin=8`;

  const smsLink = `sms:?&body=${encodeURIComponent(`Check out the "${albumTitle}" gallery: ${shareUrl}`)}`;
  const emailLink = `mailto:?subject=${encodeURIComponent(`Photos: ${albumTitle}`)}&body=${encodeURIComponent(
    `Here is the link to the high-resolution sports photos for "${albumTitle}":\n\n${shareUrl}`
  )}`;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-neutral-800/80 flex items-center justify-between bg-neutral-900/40">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-blue-950/60 border border-blue-800/60 text-blue-400">
              <Share2 size={16} />
            </span>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-white uppercase font-mono">
                Share Album
              </h2>
              <p className="text-[11px] text-neutral-400 font-mono truncate max-w-[280px]">
                {albumTitle}
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

        <div className="p-6 space-y-6">
          {/* Quick Copy URL Row */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider block">
              Direct Link
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-xs text-neutral-200 font-mono focus:outline-none select-all"
              />
              <button
                onClick={copyToClipboard}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                  copied
                    ? "bg-emerald-600 text-white shadow-lg shadow-emerald-950/40"
                    : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-950/40"
                }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? "Copied!" : "Copy"}</span>
              </button>
            </div>
          </div>

          {/* Personalized Link Creator */}
          <div className="p-3.5 rounded-xl bg-neutral-900/50 border border-neutral-800/80 space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-neutral-300 font-medium">
              <UserPlus size={14} className="text-blue-400" />
              <span>Personalize this link (Optional)</span>
            </div>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Add a recipient&apos;s name so you know who opened the gallery when they join.
            </p>
            <input
              type="text"
              placeholder="e.g., Coach Mike, Grandma, Varsity Team"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-neutral-700 font-sans"
            />
          </div>

          {/* Quick Action Channels */}
          <div className="grid grid-cols-3 gap-2.5">
            <a
              href={smsLink}
              className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900 text-neutral-300 hover:text-white transition group"
            >
              <MessageCircle size={18} className="text-emerald-400 group-hover:scale-110 transition-transform" />
              <span className="text-[11px] font-medium font-sans">Message / SMS</span>
            </a>

            <a
              href={emailLink}
              className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-neutral-900/60 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900 text-neutral-300 hover:text-white transition group"
            >
              <Mail size={18} className="text-blue-400 group-hover:scale-110 transition-transform" />
              <span className="text-[11px] font-medium font-sans">Email</span>
            </a>

            <button
              onClick={() => setShowQR(!showQR)}
              className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border transition group cursor-pointer ${
                showQR
                  ? "bg-neutral-800 border-neutral-600 text-white"
                  : "bg-neutral-900/60 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900 text-neutral-300 hover:text-white"
              }`}
            >
              <QrCode size={18} className="text-amber-400 group-hover:scale-110 transition-transform" />
              <span className="text-[11px] font-medium font-sans">{showQR ? "Hide QR" : "Show QR"}</span>
            </button>
          </div>

          {/* Expandable Scannable QR Code */}
          {showQR && (
            <div className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 flex flex-col items-center justify-center gap-2 animate-in fade-in zoom-in-95 duration-200">
              <div className="p-3 bg-white rounded-xl shadow-inner">
                <img src={qrImageUrl} alt="Album QR Code" className="w-36 h-36 object-contain" />
              </div>
              <span className="text-[10px] text-neutral-400 font-mono">
                Scan with any smartphone camera to open album instantly
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 bg-neutral-950 border-t border-neutral-900 text-center">
          <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
            Frictionless Access — No Logins Required
          </p>
        </div>
      </div>
    </div>
  );
}
