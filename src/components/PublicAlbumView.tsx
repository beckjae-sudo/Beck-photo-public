"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import JSZip from "jszip";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Calendar,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  X,
  AlertCircle,
  Coffee,
  ArrowRight,
  Share2,
  Check,
  Circle,
  CheckSquare,
  Square,
  Package,
  Play,
  Tag,
  UserRound,
} from "lucide-react";
import SupportModal, { FundType } from "@/components/SupportModal";
import ShareSheet from "@/components/ShareSheet";
import ViewerPresenceBadge from "@/components/ViewerPresenceBadge";
import ClaimModal from "@/components/ClaimModal";
import TagPicker from "@/components/TagPicker";
import TagPlayerPicker from "@/components/TagPlayerPicker";
import {
  getOrCreateVisitorProfile,
  onVisitorProfileChange,
  VisitorProfile,
} from "@/lib/visitorIdentity";
import {
  buildPlayerOptions,
  parsePlayerKey,
  playerKeyLabel,
  rosterForCategory,
} from "@/lib/players";
import {
  addAlbumTag,
  getAlbumTags,
  removeAlbumTag,
  removeAutoTag,
  TagRecord,
} from "@/app/actions/tags";
import { recordAlbumActivity } from "@/app/actions/presence";
import {
  DEFAULT_PUBLIC_CONFIG,
  PublicSiteConfig,
  clampBrightness,
} from "@/lib/types";
import { fontVariableFor } from "@/lib/fonts";

export type MediaType = "image" | "video";

export interface Photo {
  id: string;
  original_filename: string;
  width: number;
  height: number;
  aspect_ratio: number;
  type?: MediaType;
  duration?: number;
  urls: {
    thumb: string;
    display: string;
    original: string;
  };
  metadata?: any;
}

export interface AlbumData {
  album_id: string;
  title: string;
  date: string;
  category?: string;
  photos: Photo[];
}

type TouchMode = "idle" | "swiping" | "pinching" | "panning";

function formatDuration(seconds?: number): string {
  if (!seconds || isNaN(seconds)) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function PublicAlbumView() {
  const params = useParams();
  const searchParams = useSearchParams();
  const rawId = params?.id;
  // Join nested arrays (e.g. ['Sports', 'Canes_Baseball'] -> 'Sports/Canes_Baseball')
  const albumId = Array.isArray(rawId)
    ? rawId.map((segment) => decodeURIComponent(segment)).join("/")
    : decodeURIComponent((rawId as string) || "");

  const viewerName = searchParams?.get("v");

  const [album, setAlbum] = useState<AlbumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // Admin-set site config (drives the album backdrop brightness)
  const [siteConfig, setSiteConfig] = useState<PublicSiteConfig>(DEFAULT_PUBLIC_CONFIG);
  useEffect(() => {
    const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.replace(/\/$/, "");
    if (!baseUrl) return;
    fetch(`${baseUrl}/site_config_public.json`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        if (cfg) setSiteConfig({ ...DEFAULT_PUBLIC_CONFIG, ...cfg });
      })
      .catch(() => {
        // keep defaults
      });
  }, []);

  // Mosaic backdrop built from this album's own photos
  const backdropPhotos = useMemo(() => {
    const list = (album?.photos || [])
      .map((p) => p.urls?.thumb || p.urls?.display)
      .filter(Boolean) as string[];
    if (list.length === 0) return [];
    let tiles = [...list];
    while (tiles.length < 18) tiles = [...tiles, ...list];
    return tiles.slice(0, 18);
  }, [album]);
  const backdropOpacity =
    clampBrightness(siteConfig.album_backdrop_brightness, 25) / 100;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Favorites & Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [zipError, setZipError] = useState<string | null>(null);
  const zipAbortRef = useRef<AbortController | null>(null);
  const zipTargetsRef = useRef<Photo[]>([]);
  const [showFullAlbumConfirm, setShowFullAlbumConfirm] = useState(false);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const [downloadingSingle, setDownloadingSingle] = useState(false);
  // Tracks which photo's lightbox image has actually finished loading, so a
  // spinner can show while the next photo arrives (instead of the old photo
  // misleadingly lingering, which read as "the next image isn't available").
  const [loadedPhotoId, setLoadedPhotoId] = useState<string | null>(null);
  // iOS can't save files directly from the browser: hold the pending download
  // and show an in-lightbox guide BEFORE opening the new tab, so the user
  // actually sees the instructions instead of being whisked away first.
  const [iosGuide, setIosGuide] = useState<{ url: string; filename: string } | null>(null);
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("bpp-select-hint") === "1";
    } catch {
      return false;
    }
  });

  const dismissSelectHint = useCallback(() => {
    setHintDismissed(true);
    try {
      localStorage.setItem("bpp-select-hint", "1");
    } catch {}
  }, []);

  // ---- Phase 1: claimed identity, player tags, My Player view ----
  const [visitorProfile, setVisitorProfile] = useState<VisitorProfile | null>(null);
  const [albumTags, setAlbumTags] = useState<TagRecord[]>([]);
  const [viewMode, setViewMode] = useState<"all" | "my">("all");
  const [subFilterKey, setSubFilterKey] = useState<string | null>(null);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [tagMode, setTagMode] = useState(false);
  // Phase 2 sticky tagging: the ONE player tag mode applies on every tap.
  // Null = not chosen yet (entering tag mode prompts a single pick).
  const [stickyTagKey, setStickyTagKey] = useState<string | null>(null);
  const [playerPickOpen, setPlayerPickOpen] = useState(false);
  const [tagPickerPhoto, setTagPickerPhoto] = useState<Photo | null>(null);
  const [claimCardDismissed, setClaimCardDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("bpp-claim-card-dismissed") === "1";
    } catch {
      return false;
    }
  });

  const dismissClaimCard = useCallback(() => {
    setClaimCardDismissed(true);
    try {
      localStorage.setItem("bpp-claim-card-dismissed", "1");
    } catch {}
  }, []);

  useEffect(() => {
    setVisitorProfile(getOrCreateVisitorProfile());
    return onVisitorProfileChange(setVisitorProfile);
  }, []);

  useEffect(() => {
    if (!albumId) return;
    getAlbumTags(albumId)
      .then((res) => {
        if (res.success) setAlbumTags(res.tags);
      })
      .catch(() => {});
  }, [albumId]);

  // Fullscreen, Drag, Pan & Pinch Zoom State
  const [isImmersive, setIsImmersive] = useState(false);
  const [navCue, setNavCue] = useState<"both" | "left" | "right" | "none">("none");
  const [showExitPrompt, setShowExitPrompt] = useState(false);
  const [dragOffset, setDragOffset] = useState<number>(0);

  // High-Resolution Master Swap Tracking
  const [loadedHighResIds, setLoadedHighResIds] = useState<Set<string>>(new Set());

  // Zoom and Pan (State + Refs to eliminate React closure lag)
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const zoomScaleRef = useRef(1);
  const panOffsetRef = useRef({ x: 0, y: 0 });

  // Touch Gesture Tracker State Machine
  const touchMode = useRef<TouchMode>("idle");
  const touchStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pinchStartDist = useRef<number>(0);
  const pinchStartScale = useRef<number>(1);
  const lastTapTime = useRef<number>(0);
  const isDoubleTap = useRef<boolean>(false);

  const cueTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const exitPromptTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const photos = album?.photos || [];

  // ---- Phase 1 derived state ----
  const category = album?.category || "";
  const myClaims = useMemo(
    () =>
      category
        ? (visitorProfile?.claims || []).filter(
            (c) => c.category.trim().toLowerCase() === category.trim().toLowerCase()
          )
        : [],
    [visitorProfile, category]
  );
  const hasAnyClaim = (visitorProfile?.claims || []).length > 0;
  const tagsByPhoto = useMemo(() => {
    const m = new Map<string, TagRecord[]>();
    for (const t of albumTags) {
      const arr = m.get(t.photoId) || [];
      arr.push(t);
      m.set(t.photoId, arr);
    }
    return m;
  }, [albumTags]);
  const activeFilterKeys = useMemo(
    () =>
      subFilterKey
        ? new Set([subFilterKey])
        : new Set(myClaims.map((c) => c.playerKey)),
    [subFilterKey, myClaims]
  );
  const myPlayerPhotos = useMemo(
    () =>
      photos.filter((p) =>
        (tagsByPhoto.get(p.id) || []).some((t) => activeFilterKeys.has(t.playerKey))
      ),
    [photos, tagsByPhoto, activeFilterKeys]
  );
  // The grid/lightbox work off displayPhotos. In My Player view that's the
  // tagged subset. Tag mode is the exception: it always works from the full
  // album so tagging the first photo cannot collapse the grid to the tagged
  // subset. Done (finishTagMode) is what switches to the player's set.
  const displayPhotos = tagMode
    ? photos
    : viewMode === "my"
      ? myPlayerPhotos
      : photos;
  const allDisplaySelected =
    displayPhotos.length > 0 && displayPhotos.every((p) => selectedIds.has(p.id));
  const tagOptions = useMemo(
    () => buildPlayerOptions(category, siteConfig.rosters, visitorProfile?.claims || []),
    [category, siteConfig.rosters, visitorProfile]
  );

  // Phase 2 sticky tagging derived state: full label for the bar
  // ("#12 — Walker") and the short form for compact buttons ("Tag #12").
  const stickyLabel = stickyTagKey
    ? playerKeyLabel(stickyTagKey, siteConfig.rosters)
    : "";
  const stickyShortLabel = useMemo(() => {
    if (!stickyTagKey) return "";
    const parsed = parsePlayerKey(stickyTagKey);
    return parsed.number !== null ? `#${parsed.number}` : stickyLabel;
  }, [stickyTagKey, stickyLabel]);

  // If the last claim goes away, tag mode (and its sticky player) goes too.
  useEffect(() => {
    if (!hasAnyClaim && tagMode) {
      setTagMode(false);
      setStickyTagKey(null);
      setPlayerPickOpen(false);
    }
  }, [hasAnyClaim, tagMode]);

  // If the sticky player stops being a valid option (claim removed, roster
  // change), clear it — tag mode then asks for one fresh pick.
  useEffect(() => {
    if (
      stickyTagKey &&
      tagOptions.length > 0 &&
      !tagOptions.some((o) => o.key === stickyTagKey)
    ) {
      setStickyTagKey(null);
    }
  }, [stickyTagKey, tagOptions]);

  // If the last claim for this album goes away, the My Player view goes too.
  useEffect(() => {
    if (viewMode === "my" && myClaims.length === 0) {
      setViewMode("all");
      setSubFilterKey(null);
    }
  }, [viewMode, myClaims.length]);

  const selectedPhoto = selectedIndex !== null ? displayPhotos[selectedIndex] : null;

  // Reset zoom & pan synchronously when changing media or closing
  useEffect(() => {
    zoomScaleRef.current = 1;
    panOffsetRef.current = { x: 0, y: 0 };
    touchMode.current = "idle";
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    setDragOffset(0);
  }, [selectedIndex]);

  // Force-load the full-resolution original for a photo (used by the
  // background preload AND the moment zoom starts, so zooming never
  // magnifies the downscaled display version).
  const highResLoadingRef = useRef<Set<string>>(new Set());
  const ensureHighRes = useCallback((photo: Photo | null, priority: "high" | "low" | "auto" = "auto") => {
    if (!photo || photo.type === "video" || !photo.urls.original) return;
    if (highResLoadingRef.current.has(photo.id)) return;
    highResLoadingRef.current.add(photo.id);
    const img = new Image();
    img.setAttribute("fetchpriority", priority);
    img.src = photo.urls.original;
    img.onload = () => {
      setLoadedHighResIds((prev) => new Set(prev).add(photo.id));
    };
    img.onerror = () => {
      highResLoadingRef.current.delete(photo.id);
    };
  }, []);

  // Prioritized lightbox preloads.
  // The 9MB full original used to download the instant a photo opened,
  // saturating mobile bandwidth and starving the NEXT photo's small display
  // version — which is why swiping felt delayed. Now:
  //  1. Adjacent photos' display versions load FIRST at high priority, so the
  //     next/previous photo is ready the moment you swipe.
  //  2. The current photo's original loads at low priority in the background;
  //     it's only needed for zoom sharpness, never for navigation.
  useEffect(() => {
    if (selectedIndex === null || !selectedPhoto || displayPhotos.length === 0) return;
    if (selectedPhoto.type === "video") return;

    const adjacentIdx = [
      (selectedIndex + 1) % displayPhotos.length,
      (selectedIndex - 1 + displayPhotos.length) % displayPhotos.length,
      (selectedIndex + 2) % displayPhotos.length,
    ];
    adjacentIdx.forEach((idx) => {
      const item = displayPhotos[idx];
      if (item?.urls?.display && item.type !== "video") {
        const img = new Image();
        img.setAttribute("fetchpriority", "high");
        img.src = item.urls.display;
      }
    });

    ensureHighRes(selectedPhoto, "low");
  }, [selectedIndex, selectedPhoto, displayPhotos, ensureHighRes]);

  // True on mouse-capable devices (desktop). Click-to-navigate zones are
  // only rendered here so mobile tap/swipe behavior is completely untouched.
  const canHover = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    []
  );

  // Active Lightbox Photo Source (Swaps to crystal-clear original once cached)
  const activeImageSrc =
    selectedPhoto && loadedHighResIds.has(selectedPhoto.id)
      ? selectedPhoto.urls.original
      : selectedPhoto?.urls.display || "";

  // Zoom layout: when zoomed, the image gets an explicit pixel size (instead
  // of CSS transform: scale()) so the browser re-rasterizes from the
  // high-res source. transform: scale() only magnifies the already-rendered
  // small bitmap, which is why zoom looked pixelated.
  const zoomLayout = useMemo(() => {
    if (!selectedPhoto || typeof window === "undefined")
      return { w: 0, h: 0, maxPanX: 0, maxPanY: 0 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const aspect = selectedPhoto.width / selectedPhoto.height || 1;
    let w = vw * 0.85;
    let h = w / aspect;
    if (h > vh * 0.85) {
      h = vh * 0.85;
      w = h * aspect;
    }
    const zw = w * zoomScale;
    const zh = h * zoomScale;
    return {
      w: zw,
      h: zh,
      maxPanX: Math.max(0, (zw - vw) / 2),
      maxPanY: Math.max(0, (zh - vh) / 2),
    };
  }, [selectedPhoto, zoomScale]);

  const clampedPanX = Math.min(zoomLayout.maxPanX, Math.max(-zoomLayout.maxPanX, panOffset.x));
  const clampedPanY = Math.min(zoomLayout.maxPanY, Math.max(-zoomLayout.maxPanY, panOffset.y));
  const isZoomed = zoomScale > 1.05 && zoomLayout.w > 0;

  // Touch Gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    // If viewing a video, do not hijack touch events
    if (selectedPhoto?.type === "video") return;

    // 1. Two-finger Pinch Zoom Start
    if (e.touches.length === 2) {
      touchMode.current = "pinching";
      ensureHighRes(selectedPhoto);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartDist.current = dist;
      pinchStartScale.current = zoomScaleRef.current;
      setDragOffset(0);
      return;
    }

    // 2. Single-finger Touch
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const now = Date.now();

      // Double Tap to toggle Zoom (1x <-> 2.5x)
      if (now - lastTapTime.current < 300) {
        lastTapTime.current = 0;
        isDoubleTap.current = true;
        touchMode.current = "idle";

        if (zoomScaleRef.current > 1) {
          zoomScaleRef.current = 1;
          panOffsetRef.current = { x: 0, y: 0 };
          setZoomScale(1);
          setPanOffset({ x: 0, y: 0 });
        } else {
          zoomScaleRef.current = 2.5;
          setZoomScale(2.5);
          // Zooming in: make sure the full-res original is loading so the
          // zoom doesn't magnify the downscaled display version.
          ensureHighRes(selectedPhoto);
        }
        setDragOffset(0);
        return;
      }

      lastTapTime.current = now;
      isDoubleTap.current = false;
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };

      if (zoomScaleRef.current > 1.05) {
        touchMode.current = "panning";
        panStart.current = {
          x: touch.clientX - panOffsetRef.current.x,
          y: touch.clientY - panOffsetRef.current.y,
        };
      } else {
        touchMode.current = "swiping";
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (selectedPhoto?.type === "video") return;

    // Active Pinch Zoom
    if (touchMode.current === "pinching" && e.touches.length === 2 && pinchStartDist.current > 0) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = currentDist / pinchStartDist.current;
      const newScale = Math.min(Math.max(pinchStartScale.current * factor, 1), 4);
      zoomScaleRef.current = newScale;
      setZoomScale(newScale);
      return;
    }

    // Active Single-finger Movement
    if (e.touches.length === 1) {
      const touch = e.touches[0];

      // Pan within zoomed photo
      if (touchMode.current === "panning" && zoomScaleRef.current > 1.05) {
        const newPan = {
          x: touch.clientX - panStart.current.x,
          y: touch.clientY - panStart.current.y,
        };
        panOffsetRef.current = newPan;
        setPanOffset(newPan);
        return;
      }

      // Horizontal photo swipe at 1x
      if (touchMode.current === "swiping" && zoomScaleRef.current <= 1.05) {
        const deltaX = touch.clientX - touchStartPos.current.x;
        const deltaY = touch.clientY - touchStartPos.current.y;
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          setDragOffset(deltaX * 0.75);
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (selectedPhoto?.type === "video") return;

    if (isDoubleTap.current) {
      isDoubleTap.current = false;
      touchMode.current = "idle";
      setDragOffset(0);
      return;
    }

    // Handle end of pinch
    if (touchMode.current === "pinching") {
      if (e.touches.length < 2) {
        touchMode.current = "idle";
        pinchStartDist.current = 0;
        if (zoomScaleRef.current < 1.1) {
          zoomScaleRef.current = 1;
          panOffsetRef.current = { x: 0, y: 0 };
          setZoomScale(1);
          setPanOffset({ x: 0, y: 0 });
        }
      }
      setDragOffset(0);
      return;
    }

    // Handle end of pan
    if (touchMode.current === "panning") {
      touchMode.current = "idle";
      setDragOffset(0);
      return;
    }

    // Handle end of 1x swipe
    if (touchMode.current === "swiping" && zoomScaleRef.current <= 1.05) {
      touchMode.current = "idle";
      setDragOffset(0);

      if (e.changedTouches.length > 0) {
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const deltaX = endX - touchStartPos.current.x;
        const deltaY = endY - touchStartPos.current.y;

        // Next / Prev media (dominant horizontal swipe > 60px)
        if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          if (deltaX < 0) {
            showNext();
            if (isImmersive) triggerCue("right", 500);
          } else {
            showPrev();
            if (isImmersive) triggerCue("left", 500);
          }
          return;
        }

        // Swipe Down to exit Lightbox
        if (deltaY > 80 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
          if (isImmersive) {
            setShowExitPrompt(true);
            if (exitPromptTimeoutRef.current) clearTimeout(exitPromptTimeoutRef.current);
            exitPromptTimeoutRef.current = setTimeout(() => setShowExitPrompt(false), 4000);
          } else {
            exitLightbox();
          }
        }
      }
    }

    setDragOffset(0);
    touchMode.current = "idle";
  };

  // Modals & Toast State
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [supportFund, setSupportFund] = useState<FundType>("gear");
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [showDownloadToast, setShowDownloadToast] = useState(false);

  useEffect(() => {
    if (!albumId) return;

    async function loadAlbum() {
      setLoading(true);
      setErrorMessage(null);

      const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.replace(/\/$/, "");

      if (!baseUrl) {
        setErrorMessage("NEXT_PUBLIC_R2_BASE_URL environment variable is missing or empty.");
        setLoading(false);
        return;
      }

      const encodedPath = albumId
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");

      const manifestUrl = `${baseUrl}/${encodedPath}/manifest.json`;

      try {
        const res = await fetch(manifestUrl, { cache: "no-store" });
        if (!res.ok) {
          setFailedUrl(manifestUrl);
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();
        setAlbum(data);
      } catch (err: any) {
        console.error("Failed to load album:", err);
        setFailedUrl(manifestUrl);
        setErrorMessage(err.message || "Failed to load album data.");
      } finally {
        setLoading(false);
      }
    }

    loadAlbum();
  }, [albumId]);

  // Sync native browser fullscreen changes
  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement) {
        setIsImmersive(false);
        setShowExitPrompt(false);
        setNavCue("none");
      }
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!showDownloadToast) return;
    const timer = setTimeout(() => {
      setShowDownloadToast(false);
    }, 6000);
    return () => clearTimeout(timer);
  }, [showDownloadToast]);

  useEffect(() => {
    if (!downloadNote) return;
    const timer = setTimeout(() => {
      setDownloadNote(null);
    }, 9000);
    return () => clearTimeout(timer);
  }, [downloadNote]);

  const toggleFavorite = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const adding = !selectedIds.has(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (adding) dismissSelectHint();
  };

  const handleSelectAll = () => {
    if (!album) return;
    // Operates on the currently displayed set — in My Player view that's
    // the filtered set (spec §4); in All view it's the whole album, as before.
    if (allDisplaySelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        displayPhotos.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        displayPhotos.forEach((p) => next.add(p.id));
        return next;
      });
      dismissSelectHint();
    }
  };

  // Phase 1/2 tag toggle for ANY photo: add when absent; remove when the
  // existing tag is the visitor's own manual tag or a machine tag (AUTO and
  // BURST tags are provisional — any claimed visitor can correct one).
  // Someone else's manual tag is left alone. The server returns the album's
  // full updated tag list, which becomes the new local state.
  const toggleTagForPhoto = async (photo: Photo, playerKey: string) => {
    if (!visitorProfile) return;
    const existing = (tagsByPhoto.get(photo.id) || []).find(
      (t) => t.playerKey === playerKey
    );
    if (existing) {
      if (existing.source === "auto" || existing.source === "burst") {
        const res = await removeAutoTag(albumId, {
          photoId: photo.id,
          playerKey,
          visitorId: visitorProfile.id,
        });
        if (res.success) setAlbumTags(res.tags);
      } else if (existing.taggedByVisitorId === visitorProfile.id) {
        const res = await removeAlbumTag(albumId, {
          photoId: photo.id,
          playerKey,
          visitorId: visitorProfile.id,
        });
        if (res.success) setAlbumTags(res.tags);
      }
      return;
    }
    const res = await addAlbumTag(albumId, {
      photoId: photo.id,
      playerKey,
      visitorId: visitorProfile.id,
    });
    if (res.success) {
      setAlbumTags(res.tags);
      recordAlbumActivity(albumId, visitorProfile.id, { tagsMade: 1 }).catch(() => {});
    }
  };

  // TagPicker path (outside tag mode): same toggle, bound to the photo the
  // picker was opened for.
  const handleTagToggle = async (playerKey: string) => {
    if (!tagPickerPhoto) return;
    await toggleTagForPhoto(tagPickerPhoto, playerKey);
  };

  // ---- Phase 2 sticky tag mode: pick once, tap many ----
  const enterTagMode = () => {
    if (!hasAnyClaim) return;
    setTagMode(true);
    if (!stickyTagKey) setPlayerPickOpen(true);
  };
  const exitTagMode = () => {
    setTagMode(false);
    setPlayerPickOpen(false);
  };
  // Done is the deliberate end of a tagging pass: leave tag mode and only
  // then present the sticky player's tagged photos in My Player view.
  const finishTagMode = () => {
    const playerKey = stickyTagKey;
    setTagMode(false);
    setPlayerPickOpen(false);
    if (playerKey) {
      setSubFilterKey(playerKey);
      setViewMode("my");
      setSelectedIndex(null);
    }
  };
  const handlePlayerPick = (playerKey: string) => {
    setStickyTagKey(playerKey);
    setPlayerPickOpen(false);
    setTagMode(true);
  };
  const handleStickyTap = (photo: Photo) => {
    if (!stickyTagKey) {
      setTagPickerPhoto(photo);
      return;
    }
    void toggleTagForPhoto(photo, stickyTagKey);
  };

  // Fetch with a per-item timeout, wired to the batch AbortController so
  // Cancel stops in-flight requests immediately.
  // Fetch with a per-item timeout and automatic retries for transient
  // network blips (up to 3 attempts with a short backoff). A single failed
  // fetch shouldn't surface as an error to the user when a retry succeeds.
  async function fetchWithTimeout(
    url: string,
    signal: AbortSignal,
    ms = 45000,
    maxAttempts = 3
  ): Promise<Blob> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) throw new Error("__cancelled__");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      const onAbort = () => ctrl.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.blob();
      } catch (err) {
        lastErr = err;
        // Don't retry user-cancelled requests.
        if (signal.aborted || ctrl.signal.aborted) throw err;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    }
    throw lastErr;
  }

  const cancelZipping = useCallback(() => {
    zipAbortRef.current?.abort();
  }, []);

  const closeZipModal = useCallback(() => {
    setIsZipping(false);
    setZipError(null);
    setZipProgress({ current: 0, total: 0, percent: 0 });
  }, []);

  // Batch ZIP Export Generator (Handles both full-res photos and video clips)
  // Cancellable via the modal's Cancel button; selection is preserved on cancel.
  const handleDownloadBatch = async (photosToDownload?: Photo[]) => {
    if (!album) return;
    const targetPhotos =
      photosToDownload && photosToDownload.length > 0
        ? photosToDownload
        : album.photos.filter((p) => selectedIds.has(p.id));
    if (targetPhotos.length === 0) return;

    const aborter = new AbortController();
    zipAbortRef.current = aborter;
    zipTargetsRef.current = targetPhotos;
    setIsZipping(true);
    setZipError(null);
    setZipProgress({ current: 0, total: targetPhotos.length, percent: 0 });

    const fail = (message: string) => {
      setZipError(message);
    };

    try {
      const zip = new JSZip();
      const folderName = `${album.title.replace(/[^a-z0-9_-]/gi, "_")}_Media`;
      const folder = zip.folder(folderName) || zip;

      const CONCURRENCY = 3;
      const failedNames: string[] = [];
      let completed = 0;

      for (let i = 0; i < targetPhotos.length; i += CONCURRENCY) {
        if (aborter.signal.aborted) throw new Error("__cancelled__");
        const chunk = targetPhotos.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (photo, chunkIndex) => {
            if (aborter.signal.aborted) return;
            const indexNumber = i + chunkIndex + 1;
            const isVideo = photo.type === "video";
            const ext = photo.original_filename.includes(".")
              ? photo.original_filename.substring(photo.original_filename.lastIndexOf("."))
              : isVideo
              ? ".mp4"
              : ".jpg";

            const fileName = `${String(indexNumber).padStart(3, "0")}_${
              photo.original_filename || `media_${photo.id}${ext}`
            }`;

            try {
              const blob = await fetchWithTimeout(photo.urls.original, aborter.signal);
              folder.file(fileName, blob);
            } catch (firstErr) {
              if (aborter.signal.aborted) return;
              // One fallback: the smaller display version for images.
              try {
                if (!isVideo && photo.urls.display) {
                  const fallbackBlob = await fetchWithTimeout(
                    photo.urls.display,
                    aborter.signal
                  );
                  folder.file(fileName.replace(/\.[^.]+$/, ".webp"), fallbackBlob);
                } else {
                  throw firstErr;
                }
              } catch {
                if (!aborter.signal.aborted) {
                  failedNames.push(photo.original_filename || photo.id);
                }
              }
            }

            completed++;
            const percent = Math.round((completed / targetPhotos.length) * 100);
            setZipProgress({ current: completed, total: targetPhotos.length, percent });
          })
        );
      }

      if (aborter.signal.aborted) throw new Error("__cancelled__");

      if (failedNames.length === targetPhotos.length) {
        throw new Error("__none_downloaded__");
      }

      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "STORE",
      });

      if (aborter.signal.aborted) throw new Error("__cancelled__");

      const blobUrl = window.URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      // Phase 1 activity: log the delivered file count to this visitor's
      // presence record (counts only, never filenames — spec §5).
      const deliveredCount = targetPhotos.length - failedNames.length;
      if (deliveredCount > 0) {
        try {
          recordAlbumActivity(albumId, getOrCreateVisitorProfile().id, {
            downloads: deliveredCount,
          }).catch(() => {});
        } catch {}
      }

      if (failedNames.length > 0) {
        fail(
          `Saved the ZIP, but ${failedNames.length} of ${targetPhotos.length} items couldn't be added. You can retry to get the rest.`
        );
      } else {
        closeZipModal();
        setShowDownloadToast(true);
      }
    } catch (err: any) {
      if (err?.message === "__cancelled__" || aborter.signal.aborted) {
        // User cancelled — close the modal, keep the selection intact.
        closeZipModal();
      } else if (err?.message === "__none_downloaded__") {
        fail("Couldn't download any of the items. Check your connection and try again.");
      } else {
        fail(`Download failed: ${err?.message || "Network error"}`);
      }
    } finally {
      zipAbortRef.current = null;
    }
  };

  const retryZip = useCallback(() => {
    const targets = zipTargetsRef.current;
    if (targets.length === 0) {
      closeZipModal();
      return;
    }
    handleDownloadBatch(targets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album, selectedIds]);

  const triggerCue = (type: "both" | "left" | "right", duration: number) => {
    if (cueTimeoutRef.current) clearTimeout(cueTimeoutRef.current);
    setNavCue(type);
    cueTimeoutRef.current = setTimeout(() => {
      setNavCue("none");
    }, duration);
  };

  const enterFullscreen = async () => {
    setIsImmersive(true);
    setShowExitPrompt(false);
    triggerCue("both", 1000);

    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch {}
  };

  const exitFullscreen = async () => {
    setIsImmersive(false);
    setShowExitPrompt(false);
    setNavCue("none");

    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {}
  };

  const exitLightbox = async () => {
    await exitFullscreen();
    setSelectedIndex(null);
  };

  const handleBackdropClick = () => {
    if (zoomScaleRef.current > 1.05) {
      zoomScaleRef.current = 1;
      panOffsetRef.current = { x: 0, y: 0 };
      setZoomScale(1);
      setPanOffset({ x: 0, y: 0 });
      return;
    }
    exitLightbox();
  };

  const isIOSDevice = () =>
    typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);

  const isTouchDevice = () =>
    typeof navigator !== "undefined" &&
    (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  // Single-file download: fetch as a blob and trigger a real file save.
  // iOS Safari ignores the download attribute, so there we open the file
  // and tell the user how to save it instead of failing silently.
  const handleDownload = async (e: React.MouseEvent, url: string, filename: string, isVideo = false) => {
    e.stopPropagation();
    const fallbackName = filename || (isVideo ? "video.mp4" : "photo.jpg");

    if (isIOSDevice()) {
      // Don't open the tab yet — show the guide first so the instructions
      // are read BEFORE the tab switch (a toast on this page would be invisible).
      setIosGuide({ url, filename: fallbackName });
      return;
    }

    setDownloadingSingle(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fallbackName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      setShowDownloadToast(true);
      try {
        recordAlbumActivity(albumId, getOrCreateVisitorProfile().id, {
          downloads: 1,
        }).catch(() => {});
      } catch {}
    } catch (err) {
      // Show the guidance FIRST (before opening the tab) so the user actually
      // sees it, and include the technical reason to aid diagnosis.
      const reason = err instanceof Error ? err.message : String(err);
      setDownloadNote(
        `Couldn't download directly (${reason}) — right-click the image and choose Save.`
      );
      // Delay the tab open slightly so the toast paints first.
      await new Promise((r) => setTimeout(r, 600));
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setDownloadingSingle(false);
    }
  };

  function estimateAlbumSize(list: Photo[]): string {
    let bytes = 0;
    for (const p of list) {
      bytes += p.type === "video" ? 50 * 1024 * 1024 : 9 * 1024 * 1024;
    }
    if (bytes >= 1024 ** 3) return `about ${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `about ${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  }

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: album?.title || "Beck Photo Gallery",
          text: `Check out high-resolution game shots from "${album?.title}":`,
          url: window.location.href,
        });
      } catch (err) {
        // Dismissing the native sheet (AbortError) means "never mind" —
        // don't pop our own sheet on top of it. Only fall back to the
        // custom share sheet on a genuine failure.
        if ((err as Error)?.name !== "AbortError") {
          setIsShareOpen(true);
        }
      }
      return;
    }
    setIsShareOpen(true);
  };

  const openSupport = (fund: FundType = "gear") => {
    setSupportFund(fund);
    setIsSupportOpen(true);
  };

  const showNext = useCallback(() => {
    if (selectedIndex === null || displayPhotos.length === 0) return;
    setSelectedIndex((prev) => (prev !== null && prev < displayPhotos.length - 1 ? prev + 1 : 0));
  }, [selectedIndex, displayPhotos.length]);

  const showPrev = useCallback(() => {
    if (selectedIndex === null || displayPhotos.length === 0) return;
    setSelectedIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : displayPhotos.length - 1));
  }, [selectedIndex, displayPhotos.length]);

  useEffect(() => {
    if (selectedIndex === null) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        showNext();
        if (isImmersive) triggerCue("right", 500);
      }
      if (e.key === "ArrowLeft") {
        showPrev();
        if (isImmersive) triggerCue("left", 500);
      }
      if (e.key === "Escape") {
        if (isImmersive) {
          exitFullscreen();
        } else {
          setSelectedIndex(null);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, showNext, showPrev, isImmersive]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white gap-3">
        <Loader2 size={32} className="animate-spin text-blue-500" />
        <p className="text-sm text-neutral-400 font-mono">Loading gallery archive...</p>
      </div>
    );
  }

  if (errorMessage || !album) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-center space-y-4 text-white max-w-lg mx-auto">
        <AlertCircle size={40} className="text-red-400 mx-auto" />
        <h2 className="text-lg font-bold">Unable to Load Album</h2>
        <p className="text-neutral-400 text-xs font-mono bg-neutral-900 border border-neutral-800 p-3 rounded-lg text-left break-all">
          <strong>Error:</strong> {errorMessage || "Album not found"}<br />
          {failedUrl && <><strong>Target:</strong> {failedUrl}</>}
        </p>
        <Link href="/" className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-semibold">
          Return to Galleries
        </Link>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-neutral-950 text-neutral-100 pb-28 relative select-none"
      style={{ fontFamily: `var(${fontVariableFor(siteConfig.font_ui)})` }}
    >
      {/* Mosaic backdrop from this album's photos (admin-set brightness) */}
      {backdropPhotos.length > 0 && (
        <div
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
          style={{ opacity: backdropOpacity }}
          aria-hidden="true"
        >
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 p-1 -rotate-1 scale-105 filter saturate-75 contrast-110">
            {backdropPhotos.map((url, idx) => (
              <div
                key={`${url}-${idx}`}
                className={`rounded-xl overflow-hidden bg-neutral-900 border border-white/5 ${
                  idx % 3 === 0 ? "aspect-4/3" : idx % 2 === 0 ? "aspect-square" : "aspect-3/4"
                }`}
              >
                <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-t from-neutral-950 via-transparent to-neutral-950/80" />
      <header className="border-b border-neutral-800/80 sticky top-0 z-30 bg-neutral-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition py-2.5 px-4 min-h-[40px] rounded-xl shadow-lg shadow-blue-950/40"
          >
            <ArrowLeft size={14} /> See more albums
          </Link>

          <div className="flex items-center gap-2.5">
            {/* Download Full Album Button — confirm first (large download) */}
            <button
              onClick={() => setShowFullAlbumConfirm(true)}
              disabled={isZipping}
              className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-1.5 px-3 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer shadow-sm disabled:opacity-50"
              title="Download entire album as ZIP"
            >
              <Package size={12} className="text-emerald-400" />
              <span>DOWNLOAD ALBUM (.ZIP)</span>
            </button>

            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-2 px-3 min-h-[40px] rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer shadow-sm"
              title="Share this album"
            >
              <Share2 size={12} className="text-blue-400" />
              <span>SHARE</span>
            </button>

            <button
              onClick={() => openSupport("gear")}
              className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-2 px-3 min-h-[40px] rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer shadow-sm"
              title="Sideline Support &amp; Gear Funds"
            >
              <Coffee size={12} className="text-amber-400" />
              <span className="hidden sm:inline">SUPPORT</span>
            </button>

            <span className="text-xs font-mono text-neutral-500 flex items-center gap-1 pl-1">
              <Layers size={12} /> {photos.length} items
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-10 space-y-8 relative z-10">
        <div className="space-y-3">
          {viewerName && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-blue-950/60 border border-blue-800/80 text-blue-300">
              <span>👋 Welcome, {viewerName}!</span>
            </div>
          )}

          {album.category && (
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-400 font-mono block">
              {album.category}
            </span>
          )}
          <h1 className="text-3xl md:text-4xl font-extrabold text-white">{album.title}</h1>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1 border-b border-neutral-800/60 pb-4">
            <div className="flex items-center gap-4">
              {album.date && (
                <div className="flex items-center gap-1.5 text-xs text-neutral-400 font-mono">
                  <Calendar size={13} />
                  <span>{album.date}</span>
                </div>
              )}
              <button
                onClick={handleSelectAll}
                className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-2 px-3 min-h-[40px] rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer shadow-sm"
                title="Select every photo in this album for download"
              >
                {allDisplaySelected ? (
                  <CheckSquare size={13} className="text-pink-400" />
                ) : (
                  <Square size={13} />
                )}
                <span>
                  {allDisplaySelected ? "Deselect All" : "Select All for Download"}
                </span>
              </button>

              {/* Phase 1: My Player entry point / view toggle (claimed only
                  for the toggle; the button itself is the claim invitation) */}
              {category &&
                (myClaims.length > 0 ? (
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-neutral-900/80 border border-neutral-800 shadow-sm">
                    <button
                      type="button"
                      onClick={() => {
                        setViewMode("all");
                        setSelectedIndex(null);
                      }}
                      className={`px-3 py-1.5 min-h-[32px] rounded-md text-xs font-mono transition cursor-pointer ${
                        viewMode === "all"
                          ? "bg-neutral-700 text-white"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      All photos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setViewMode("my");
                        setSelectedIndex(null);
                      }}
                      className={`px-3 py-1.5 min-h-[32px] rounded-md text-xs font-mono transition cursor-pointer flex items-center gap-1.5 ${
                        viewMode === "my"
                          ? "bg-blue-600 text-white"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      <UserRound size={12} />
                      My Player
                    </button>
                    <button
                      type="button"
                      onClick={() => (tagMode ? exitTagMode() : enterTagMode())}
                      aria-pressed={tagMode}
                      title="Tag mode: pick your player once, then tap photos to tag them"
                      className={`px-3 py-1.5 min-h-[32px] rounded-md text-xs font-mono transition cursor-pointer flex items-center gap-1.5 ${
                        tagMode
                          ? "bg-emerald-600 text-white"
                          : "text-neutral-400 hover:text-white"
                      }`}
                    >
                      <Tag size={12} />
                      Tag mode
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setClaimModalOpen(true)}
                    className="flex items-center gap-1.5 text-xs font-mono text-neutral-300 hover:text-white transition py-2 px-3 min-h-[40px] rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 cursor-pointer shadow-sm"
                    title="Pick your player to see only their photos"
                  >
                    <UserRound size={13} className="text-blue-400" />
                    <span>My Player</span>
                  </button>
                ))}
            </div>

          </div>

          {/* My Player status line + multi-player sub-filter */}
          {viewMode === "my" && myClaims.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-neutral-300 font-mono">
                {myPlayerPhotos.length} of {photos.length} photos feature{" "}
                {subFilterKey
                  ? playerKeyLabel(subFilterKey, siteConfig.rosters)
                  : myClaims
                      .map((c) => playerKeyLabel(c.playerKey, siteConfig.rosters))
                      .join(", ")}
              </span>
              {myClaims.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSubFilterKey(null);
                      setSelectedIndex(null);
                    }}
                    className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border transition cursor-pointer ${
                      subFilterKey === null
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white"
                    }`}
                  >
                    All my players
                  </button>
                  {myClaims.map((c) => (
                    <button
                      key={c.playerKey}
                      type="button"
                      onClick={() => {
                        setSubFilterKey(c.playerKey);
                        setSelectedIndex(null);
                      }}
                      className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border transition cursor-pointer ${
                        subFilterKey === c.playerKey
                          ? "bg-blue-600 border-blue-500 text-white"
                          : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white"
                      }`}
                    >
                      {playerKeyLabel(c.playerKey, siteConfig.rosters)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Phase 1 claim invitation — unclaimed visitors only, dismissible
            and remembered; never blocks anything (spec §1). */}
        {category && myClaims.length === 0 && !claimCardDismissed && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-blue-950/40 border border-blue-800/50 text-blue-100">
            <UserRound size={16} className="text-blue-400 shrink-0" />
            <p className="text-xs flex-1 min-w-[200px] leading-relaxed">
              Here for a player?{" "}
              <span className="text-blue-200/75">
                Pick your player and see only their photos — and download just those.
              </span>
            </p>
            <button
              type="button"
              onClick={() => setClaimModalOpen(true)}
              className="px-4 py-2 min-h-[40px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-950/40 transition cursor-pointer"
            >
              Pick your player
            </button>
            <button
              type="button"
              onClick={dismissClaimCard}
              className="p-1.5 rounded-lg text-blue-300/70 hover:text-blue-100 hover:bg-blue-900/50 transition cursor-pointer"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="max-w-7xl mx-auto px-6">
          <ViewerPresenceBadge
            albumId={albumId}
            onOpenClaim={() => setClaimModalOpen(true)}
          />
        </div>

        {/* One-time hint: how photo selection works */}
        {!hintDismissed && selectedIds.size === 0 && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-blue-950/40 border border-blue-800/50 text-blue-200 text-xs">
            <Check size={14} className="shrink-0 text-blue-400" strokeWidth={3} />
            <span>
              Tap the <span className="font-semibold">circle</span> on any photo to select it for
              download — selected photos show a checkmark.
            </span>
            <button
              type="button"
              onClick={dismissSelectHint}
              className="ml-auto p-1.5 rounded-lg text-pink-300/70 hover:text-pink-100 hover:bg-pink-900/50 transition cursor-pointer"
              aria-label="Dismiss hint"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* My Player cold-start empty state (spec §3): no tags yet for the
            claimed player(s). Tag mode keeps the full album browsable below
            so the first tagger can build the view. */}
        {viewMode === "my" && myPlayerPhotos.length === 0 && (
          <div className="px-5 py-6 rounded-xl bg-neutral-900/70 border border-neutral-800 text-center space-y-3">
            <p className="text-sm text-neutral-200 font-semibold">
              No one&apos;s tagged{" "}
              {subFilterKey
                ? playerKeyLabel(subFilterKey, siteConfig.rosters)
                : myClaims
                    .map((c) => playerKeyLabel(c.playerKey, siteConfig.rosters))
                    .join(" or ")}{" "}
              yet.
            </p>
            <p className="text-xs text-neutral-400 leading-relaxed max-w-md mx-auto">
              Tap &quot;Tag player&quot; on any photo of them and this view builds
              itself — every later visitor gets the filtered album instantly.
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => (tagMode ? exitTagMode() : enterTagMode())}
                aria-pressed={tagMode}
                className={`inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold transition cursor-pointer ${
                  tagMode
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                    : "bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
                }`}
              >
                <Tag size={13} />
                {tagMode ? "Tag mode is on — tap photos to tag your player" : "Turn on Tag mode"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("all");
                  setSelectedIndex(null);
                }}
                className="px-4 py-2 min-h-[40px] rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold transition cursor-pointer"
              >
                Browse all photos
              </button>
            </div>
          </div>
        )}

        {/* Phase 2 sticky tag bar: persistent while tag mode is on. Sits at
            z-40 so the lightbox (z-50) covers it — the lightbox has its own
            one-tap sticky tag button. */}
        {tagMode && stickyTagKey && hasAnyClaim && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2.5 pl-3.5 pr-2 py-2 rounded-full bg-emerald-950/95 border border-emerald-700/70 shadow-2xl backdrop-blur-md text-emerald-100 animate-in fade-in slide-in-from-top-2 duration-200 max-w-[94vw]">
            <Tag size={13} className="text-emerald-400 shrink-0" />
            <span className="text-xs whitespace-nowrap overflow-hidden text-ellipsis">
              Tagging: <span className="font-bold text-white">{stickyLabel}</span>
            </span>
            <span className="hidden md:inline text-[11px] text-emerald-300/70 whitespace-nowrap">
              Tap a photo to tag it · tap again to remove
            </span>
            <button
              type="button"
              onClick={() => setPlayerPickOpen(true)}
              className="px-2.5 py-1.5 rounded-full bg-emerald-900/80 hover:bg-emerald-800 text-emerald-100 text-[11px] font-semibold transition cursor-pointer shrink-0"
            >
              Switch
            </button>
            <button
              type="button"
              onClick={finishTagMode}
              className="px-2.5 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition cursor-pointer shrink-0"
            >
              Done
            </button>
          </div>
        )}

        {/* Dynamic Masonry Grid (Photos + Video Posters) */}
        <div className="columns-2 sm:columns-3 md:columns-4 gap-4">
          {displayPhotos.map((photo, idx) => {
            const isFav = selectedIds.has(photo.id);
            const isVideo = photo.type === "video";
            const isStickyTagged =
              tagMode &&
              !!stickyTagKey &&
              (tagsByPhoto.get(photo.id) || []).some(
                (t) => t.playerKey === stickyTagKey
              );

            return (
              <div
                key={photo.id}
                className={`break-inside-avoid mb-4 group relative rounded-xl overflow-hidden bg-neutral-900 border transition cursor-pointer ${
                  isStickyTagged
                    ? "border-emerald-500 ring-2 ring-emerald-500/50"
                    : "border-neutral-800/90 hover:border-neutral-700"
                }`}
                onClick={() => {
                  // Tag mode: tapping a photo applies the sticky player
                  // instantly — no picker (claimed visitors only).
                  // With no sticky player chosen yet it falls back to the
                  // picker for that photo.
                  if (tagMode && hasAnyClaim) {
                    handleStickyTap(photo);
                  } else {
                    setSelectedIndex(idx);
                  }
                }}
              >
                <img
                  src={photo.urls.thumb}
                  alt={photo.original_filename}
                  className="w-full h-auto block object-cover group-hover:scale-[1.02] transition duration-300"
                  loading="lazy"
                  style={photo.aspect_ratio ? { aspectRatio: `${photo.aspect_ratio}` } : undefined}
                />

                {isStickyTagged && (
                  <div className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold shadow-lg shadow-emerald-950/40 pointer-events-none">
                    <Check size={11} strokeWidth={3} />
                    Tagged
                  </div>
                )}

                {/* Video Play Badge & Duration Indicator */}
                {isVideo && (
                  <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/75 backdrop-blur-md text-[11px] font-mono text-white pointer-events-none shadow-md">
                    <Play size={10} className="fill-white text-white" />
                    {photo.duration ? <span>{formatDuration(photo.duration)}</span> : <span>VIDEO</span>}
                  </div>
                )}

                <button
                  type="button"
                  onClick={(e) => toggleFavorite(e, photo.id)}
                  className={`absolute top-2 left-2 p-2.5 rounded-full backdrop-blur-md transition-all duration-200 z-10 cursor-pointer ${
                    isFav
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-950/50 opacity-100 scale-100"
                      : "bg-black/60 text-white/70 hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
                  }`}
                  title={isFav ? "Remove from selection" : "Select for download"}
                  aria-label={isFav ? "Remove from download selection" : "Select photo for download"}
                  aria-pressed={isFav}
                >
                  {isFav ? <Check size={14} strokeWidth={3} /> : <Circle size={14} />}
                </button>

                <div className="hidden sm:flex absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 items-center justify-center gap-2 pointer-events-none">
                  <span className="p-2 rounded-full bg-black/60 text-white backdrop-blur-md">
                    <Maximize2 size={16} />
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleDownload(e, photo.urls.original, photo.original_filename, isVideo)}
                    className="p-2 rounded-full bg-black/60 text-white hover:text-blue-400 backdrop-blur-md transition cursor-pointer pointer-events-auto"
                    title={isVideo ? "Download Video" : "Download High-Res Original"}
                  >
                    <Download size={16} />
                  </button>
                </div>

                {/* Phase 1/2: tag button (claimed visitors only). In tag
                    mode with a sticky player it applies that player
                    instantly; otherwise it opens the tag picker. */}
                {hasAnyClaim && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (tagMode && stickyTagKey) {
                        handleStickyTap(photo);
                      } else {
                        setTagPickerPhoto(photo);
                      }
                    }}
                    className={`absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 px-2.5 py-2 rounded-full backdrop-blur-md transition cursor-pointer ${
                      tagMode
                        ? "bg-emerald-600 text-white shadow-lg shadow-emerald-950/50 opacity-100"
                        : "bg-black/60 text-white/80 hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
                    }`}
                    title={
                      tagMode && stickyTagKey
                        ? `Tag ${stickyLabel} in this photo`
                        : "Tag a player in this photo"
                    }
                    aria-label="Tag a player in this photo"
                  >
                    <Tag size={13} />
                    {(tagsByPhoto.get(photo.id) || []).length > 0 && (
                      <span className="text-[10px] font-mono font-bold">
                        {(tagsByPhoto.get(photo.id) || []).length}
                      </span>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Floating Batch Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 inset-x-0 mx-auto w-fit max-w-[92vw] z-40 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-neutral-900/95 border border-neutral-700/80 shadow-2xl backdrop-blur-xl text-white">
            <div className="flex items-center gap-2 pr-2 border-r border-neutral-700">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-pink-600 text-xs font-bold font-mono">
                {selectedIds.size}
              </span>
              <span className="text-xs font-medium hidden sm:inline">Selected</span>
            </div>

            <button
              onClick={() => handleDownloadBatch()}
              disabled={isZipping}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-blue-950/40 transition cursor-pointer"
            >
              <Download size={14} />
              <span>Download Selected (.ZIP)</span>
            </button>

            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-semibold transition cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Lightbox Modal (Unified Photos & Video Player) */}
      {selectedPhoto !== null && selectedIndex !== null && (
        <div
          className={`fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden touch-none ${
            isImmersive ? "w-screen h-[100dvh]" : "bg-black/95 backdrop-blur-md"
          }`}
          onClick={handleBackdropClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Loading spinner while the current photo's image arrives (the old
              photo no longer lingers, so this makes the loading state honest) */}
          {selectedPhoto.type !== "video" && loadedPhotoId !== selectedPhoto.id && (
            <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
              <Loader2 size={36} className="animate-spin text-white/50" />
            </div>
          )}
          {!isImmersive && (
            <>
              {/* Top Controls */}
              <div className="absolute top-4 right-4 flex items-center gap-2.5 z-50">
                <span className="text-xs font-mono font-medium text-neutral-400 bg-white/5 px-2.5 py-1.5 rounded-lg border border-white/10">
                  {selectedIndex + 1} / {displayPhotos.length}
                </span>

                <button
                  type="button"
                  onClick={(e) => toggleFavorite(e, selectedPhoto.id)}
                  className={`p-2.5 rounded-lg backdrop-blur-md transition cursor-pointer ${
                    selectedIds.has(selectedPhoto.id)
                      ? "bg-blue-600 text-white"
                      : "bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white"
                  }`}
                  title={selectedIds.has(selectedPhoto.id) ? "Remove from selection" : "Select for download"}
                  aria-label={selectedIds.has(selectedPhoto.id) ? "Remove from download selection" : "Select photo for download"}
                >
                  {selectedIds.has(selectedPhoto.id) ? <Check size={16} strokeWidth={3} /> : <Circle size={16} />}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    enterFullscreen();
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-950/40 transition cursor-pointer"
                  title="Full Screen View"
                >
                  <Maximize2 size={13} />
                  <span>Full Screen</span>
                </button>

                <button
                  type="button"
                  disabled={downloadingSingle}
                  onClick={(e) =>
                    handleDownload(
                      e,
                      selectedPhoto.urls.original,
                      selectedPhoto.original_filename,
                      selectedPhoto.type === "video"
                    )
                  }
                  className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white text-xs font-semibold backdrop-blur-md transition cursor-pointer"
                  title="Download this file"
                >
                  {downloadingSingle ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  <span className="hidden sm:inline">
                    {downloadingSingle ? "Saving…" : "Download"}
                  </span>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    exitLightbox();
                  }}
                  className="p-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white backdrop-blur-md transition cursor-pointer"
                  aria-label="Close photo viewer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Phase 1/2: this photo's player tags (chips) + tag controls.
                  Chips show players, never who tagged them (spec §5). AUTO
                  and BURST chips carry a source marker and, for claimed
                  visitors, an × to remove a wrong machine tag ("Not #12").
                  In tag mode a one-tap sticky Tag/Untag button acts on this
                  photo. */}
              {((tagsByPhoto.get(selectedPhoto.id) || []).length > 0 ||
                hasAnyClaim ||
                (tagMode && stickyTagKey)) && (
                <div
                  className="absolute bottom-4 left-4 z-50 flex flex-wrap items-center gap-1.5 max-w-[75vw]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {(tagsByPhoto.get(selectedPhoto.id) || []).map((t) => {
                    const isAuto = t.source === "auto";
                    const isBurst = t.source === "burst";
                    const isMachine = isAuto || isBurst;
                    const removable = isMachine && hasAnyClaim;
                    const sourceLabel = isAuto ? "auto" : isBurst ? "burst" : "";
                    return (
                      <span
                        key={t.playerKey}
                        className={`inline-flex items-center gap-1 pl-2.5 ${removable ? "pr-1.5" : "pr-2.5"} py-1.5 rounded-full border text-[11px] font-semibold backdrop-blur-md ${
                          isAuto
                            ? "bg-amber-950/80 border-amber-800/70 text-amber-100"
                            : isBurst
                              ? "bg-emerald-950/80 border-emerald-800/70 text-emerald-100"
                              : "bg-blue-950/80 border-blue-800/70 text-blue-100"
                        }`}
                      >
                        <Tag size={10} />
                        {playerKeyLabel(t.playerKey, siteConfig.rosters)}
                        {sourceLabel && (
                          <span
                            className={`text-[9px] font-mono uppercase ${
                              isAuto ? "text-amber-300/80" : "text-emerald-300/80"
                            }`}
                          >
                            {sourceLabel}
                          </span>
                        )}
                        {removable && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleTagForPhoto(selectedPhoto, t.playerKey);
                            }}
                            className={`p-0.5 rounded-full transition cursor-pointer ${
                              isAuto
                                ? "text-amber-200/70 hover:text-white hover:bg-amber-800/60"
                                : "text-emerald-200/70 hover:text-white hover:bg-emerald-800/60"
                            }`}
                            title={`Not ${playerKeyLabel(t.playerKey, siteConfig.rosters)}? Remove this ${sourceLabel} tag`}
                            aria-label={`Remove ${sourceLabel} tag ${playerKeyLabel(t.playerKey, siteConfig.rosters)}`}
                          >
                            <X size={11} />
                          </button>
                        )}
                      </span>
                    );
                  })}
                  {tagMode && stickyTagKey && hasAnyClaim && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleTagForPhoto(selectedPhoto, stickyTagKey);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[32px] rounded-full bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-white text-[11px] font-bold backdrop-blur-md transition cursor-pointer"
                    >
                      <Tag size={10} />
                      {(tagsByPhoto.get(selectedPhoto.id) || []).some(
                        (t) => t.playerKey === stickyTagKey
                      )
                        ? `Untag ${stickyShortLabel}`
                        : `Tag ${stickyShortLabel}`}
                    </button>
                  )}
                  {hasAnyClaim && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTagPickerPhoto(selectedPhoto);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[32px] rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white text-[11px] font-semibold backdrop-blur-md transition cursor-pointer"
                    >
                      <Tag size={10} />
                      Tag player
                    </button>
                  )}
                </div>
              )}

              {/* Desktop Next / Prev Chevrons */}
              {photos.length > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      showPrev();
                    }}
                    className="hidden sm:block absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition z-50 cursor-pointer"
                    title="Previous (Left Arrow)"
                  >
                    <ChevronLeft size={28} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      showNext();
                    }}
                    className="hidden sm:block absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition z-50 cursor-pointer"
                    title="Next (Right Arrow)"
                  >
                    <ChevronRight size={28} />
                  </button>
                </>
              )}

              {/* Standard Media Display */}
              {selectedPhoto.type === "video" ? (
                <div
                  className="max-h-[85vh] max-w-[90vw] flex items-center justify-center"
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchMove={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  <video
                    key={selectedPhoto.id}
                    src={selectedPhoto.urls.original}
                    poster={selectedPhoto.urls.thumb}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    className="max-h-[85vh] max-w-[90vw] rounded-lg shadow-2xl bg-black"
                  />
                </div>
              ) : (
                <div
                  className="flex items-center justify-center shrink-0"
                  style={{
                    ...(isZoomed
                      ? { width: zoomLayout.w, height: zoomLayout.h }
                      : { maxHeight: "85vh", maxWidth: "85vw" }),
                    transform: `translate3d(${clampedPanX + (isZoomed ? 0 : dragOffset)}px, ${clampedPanY}px, 0px)`,
                    touchAction: "none",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <img
                    key={selectedPhoto.id}
                    src={activeImageSrc}
                    onLoad={() => setLoadedPhotoId(selectedPhoto.id)}
                    alt={selectedPhoto.original_filename}
                    className="rounded-lg shadow-2xl pointer-events-none select-none"
                    style={
                      isZoomed
                        ? { width: "100%", height: "100%", objectFit: "contain" }
                        : { maxHeight: "85vh", maxWidth: "85vw", objectFit: "contain" }
                    }
                    draggable={false}
                  />
                </div>
              )}
            </>
          )}

          {/* Fullscreen Immersive Display */}
          {isImmersive && (
            <div
              className="relative w-full h-full flex items-center justify-center transition-transform ease-out"
              style={
                selectedPhoto.type === "video"
                  ? undefined
                  : {
                      transform: `translate3d(${dragOffset + panOffset.x}px, ${panOffset.y}px, 0px) scale(${zoomScale})`,
                      transitionDuration: touchMode.current !== "idle" || zoomScale > 1 ? "0ms" : "150ms",
                      touchAction: "none",
                      willChange: touchMode.current !== "idle" ? "transform" : "auto",
                    }
              }
              onClick={(e) => e.stopPropagation()}
            >
              {selectedPhoto.type === "video" ? (
                <div
                  className="w-full h-full flex items-center justify-center p-2"
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchMove={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  <video
                    key={selectedPhoto.id}
                    src={selectedPhoto.urls.original}
                    poster={selectedPhoto.urls.thumb}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    className="max-h-full max-w-full rounded-lg shadow-2xl bg-black"
                  />
                </div>
              ) : (
                <img
                  key={selectedPhoto.id}
                  src={activeImageSrc}
                  onLoad={() => setLoadedPhotoId(selectedPhoto.id)}
                  alt={selectedPhoto.original_filename}
                  className="w-full h-full object-contain pointer-events-none select-none"
                  style={{
                    imageRendering: "-webkit-optimize-contrast" as any,
                    WebkitBackfaceVisibility: "hidden",
                    backfaceVisibility: "hidden",
                  }}
                />
              )}

              <div
                className={`pointer-events-none absolute left-4 sm:left-8 top-1/2 -translate-y-1/2 transition-opacity duration-300 z-30 ${
                  navCue === "both" || navCue === "left" ? "opacity-35" : "opacity-0"
                }`}
              >
                <ChevronLeft className="w-12 h-12 sm:w-16 sm:h-16 text-white stroke-[2.5]" />
              </div>

              <div
                className={`pointer-events-none absolute right-4 sm:right-8 top-1/2 -translate-y-1/2 transition-opacity duration-300 z-30 ${
                  navCue === "both" || navCue === "right" ? "opacity-35" : "opacity-0"
                }`}
              >
                <ChevronRight className="w-12 h-12 sm:w-16 sm:h-16 text-white stroke-[2.5]" />
              </div>

              {showExitPrompt && (
                <div className="absolute top-6 inset-x-0 mx-auto w-fit z-40 animate-in fade-in slide-in-from-top-3 duration-200">
                  <button
                    onClick={exitFullscreen}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-neutral-900/90 hover:bg-neutral-800 text-white border border-neutral-700 shadow-2xl backdrop-blur-xl text-xs font-semibold cursor-pointer"
                  >
                    <Minimize2 size={13} className="text-blue-400" />
                    <span>Exit Full Screen</span>
                  </button>
                </div>
              )}

              {/* Desktop click-to-navigate zones (mouse only — never rendered on
                  touch devices, so mobile swipe behavior is untouched) */}
              {canHover && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      showPrev();
                      triggerCue("left", 500);
                    }}
                    className="absolute left-0 top-0 bottom-0 w-[30%] z-20 cursor-w-resize"
                    aria-label="Previous photo"
                    title="Previous photo"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      showNext();
                      triggerCue("right", 500);
                    }}
                    className="absolute right-0 top-0 bottom-0 w-[30%] z-20 cursor-e-resize"
                    aria-label="Next photo"
                    title="Next photo"
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ZIP Progress Modal — cancellable, with error + retry (selection preserved) */}
      {isZipping && (
        <div className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
          <div className="bg-neutral-950 border border-neutral-800 p-6 rounded-2xl max-w-sm w-full space-y-4 text-center shadow-2xl">
            {zipError ? (
              <>
                <div className="w-12 h-12 rounded-xl bg-red-950/80 border border-red-800/80 text-red-400 flex items-center justify-center mx-auto">
                  <AlertCircle size={24} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                    Download hiccup
                  </h3>
                  <p className="text-xs text-neutral-400 leading-relaxed">{zipError}</p>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={retryZip}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer"
                  >
                    <Download size={14} />
                    <span>Retry</span>
                  </button>
                  <button
                    onClick={closeZipModal}
                    className="flex-1 px-4 py-2.5 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-semibold transition cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-xl bg-blue-950/80 border border-blue-800/80 text-blue-400 flex items-center justify-center mx-auto">
                  <Package size={24} className="animate-bounce" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                    Packaging Media ZIP
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono">
                    Item {zipProgress.current} of {zipProgress.total} ({zipProgress.percent}%)
                  </p>
                </div>

                <div className="w-full bg-neutral-900 rounded-full h-2 overflow-hidden border border-neutral-800">
                  <div
                    className="bg-blue-600 h-full transition-all duration-200 rounded-full"
                    style={{ width: `${zipProgress.percent}%` }}
                  />
                </div>
                <p className="text-[11px] text-neutral-500">
                  Packing full-resolution assets in memory...
                </p>
                <button
                  onClick={cancelZipping}
                  className="w-full px-4 py-2.5 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Full-album download confirmation (FIX 4) */}
      {showFullAlbumConfirm && (
        <div className="fixed inset-0 z-[95] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
          <div className="bg-neutral-950 border border-neutral-800 p-6 rounded-2xl max-w-sm w-full space-y-4 text-center shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-800/80 text-emerald-400 flex items-center justify-center mx-auto">
              <Package size={24} />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                Download full album?
              </h3>
              <p className="text-xs text-neutral-300 font-mono">
                {photos.length} items • {estimateAlbumSize(photos)}
              </p>
              <p className="text-[11px] text-neutral-500 leading-relaxed pt-1">
                This packages every full-resolution file in your browser and can take several
                minutes, especially on mobile data.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  setShowFullAlbumConfirm(false);
                  handleDownloadBatch(album.photos);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer"
              >
                <Download size={14} />
                <span>Download</span>
              </button>
              <button
                onClick={() => setShowFullAlbumConfirm(false)}
                className="flex-1 px-4 py-2.5 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iOS download guide: shown BEFORE opening the new tab so the
          instructions are read first (a toast would be left behind on the page). */}
      {iosGuide && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
          onClick={() => setIosGuide(null)}
        >
          <div
            className="w-full max-w-xs rounded-2xl bg-neutral-900 border border-white/10 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 mb-3">
              <Download size={18} className="text-blue-400" />
              <h3 className="text-white text-sm font-bold">Saving this photo</h3>
            </div>
            <p className="text-neutral-300 text-[13px] leading-relaxed mb-1">
              iPhone can&apos;t save files straight from the browser.
            </p>
            <p className="text-neutral-300 text-[13px] leading-relaxed mb-5">
              Tap <span className="text-white font-semibold">Open Full Photo</span> below,
              then <span className="text-white font-semibold">touch and hold</span> the
              image and tap <span className="text-white font-semibold">Save to Photos</span>.
            </p>
            <button
              type="button"
              onClick={() => {
                try {
                  recordAlbumActivity(albumId, getOrCreateVisitorProfile().id, {
                    downloads: 1,
                  }).catch(() => {});
                } catch {}
                window.open(iosGuide.url, "_blank", "noopener");
                setIosGuide(null);
              }}
              className="w-full min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition cursor-pointer mb-2"
            >
              Open Full Photo
            </button>
            <button
              type="button"
              onClick={() => setIosGuide(null)}
              className="w-full min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-neutral-300 text-sm font-semibold transition cursor-pointer"
            >
              Not Now
            </button>
          </div>
        </div>
      )}

      {/* Fallback guidance toast (when a direct download isn't possible) */}
      {downloadNote && (        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[80] max-w-sm w-[calc(100vw-3rem)] p-4 rounded-xl bg-amber-950/95 backdrop-blur-md border border-amber-800/80 text-white shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-100 leading-relaxed flex-1">{downloadNote}</p>
            <button
              onClick={() => setDownloadNote(null)}
              className="text-amber-300/70 hover:text-amber-100 transition p-1 -m-1 cursor-pointer shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {showDownloadToast && (
        <div className="fixed bottom-6 right-6 z-[70] max-w-sm w-[calc(100vw-3rem)] p-4 rounded-xl bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 text-white shadow-2xl flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold font-mono uppercase tracking-wider text-neutral-200">
                Download Complete
              </span>
            </div>
            <button
              onClick={() => setShowDownloadToast(false)}
              className="text-neutral-400 hover:text-white transition p-0.5 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          <p className="text-xs text-neutral-300 leading-relaxed font-sans">
            Downloaded high-res media! Love the gallery? Consider supporting the gear &amp; storage fund.
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setShowDownloadToast(false);
                openSupport("gear");
              }}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-blue-950/40 cursor-pointer"
            >
              <span>View Gear Fund</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Phase 1: claim flow + tag picker */}
      {visitorProfile && category && (
        <ClaimModal
          open={claimModalOpen}
          onClose={() => setClaimModalOpen(false)}
          category={category}
          roster={rosterForCategory(siteConfig.rosters, category)}
          profile={visitorProfile}
          onSaved={(p) => {
            setVisitorProfile(p);
            // Immediate reward (spec §1): a fresh claim for this album
            // switches straight into the My Player view.
            if (
              (p.claims || []).some(
                (c) => c.category.trim().toLowerCase() === category.trim().toLowerCase()
              )
            ) {
              setViewMode("my");
              setSelectedIndex(null);
            }
          }}
        />
      )}

      <TagPicker
        photo={tagPickerPhoto}
        options={tagOptions}
        photoTags={tagPickerPhoto ? tagsByPhoto.get(tagPickerPhoto.id) || [] : []}
        visitorId={visitorProfile?.id || ""}
        onToggle={handleTagToggle}
        onClose={() => setTagPickerPhoto(null)}
      />

      {/* Phase 2: tag mode's one-time sticky player pick (and Switch). */}
      <TagPlayerPicker
        open={playerPickOpen}
        options={tagOptions}
        currentKey={stickyTagKey}
        onPick={handlePlayerPick}
        onClose={() => {
          setPlayerPickOpen(false);
          // Cancelling the FIRST pick (nothing chosen yet) leaves tag mode.
          if (!stickyTagKey) setTagMode(false);
        }}
      />

      <ShareSheet
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        albumTitle={album.title}
        albumId={albumId}
      />

      <SupportModal
        isOpen={isSupportOpen}
        onClose={() => setIsSupportOpen(false)}
        defaultFund={supportFund}
      />
    </div>
  );
}
