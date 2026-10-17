"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  checkAdminAuth,
  loginAdmin,
  createAlbum,
  getDirectUploadUrl,
  savePublicSiteConfig,
  deleteAlbum,
  importAlbumsFromFamily,
} from "@/app/admin/actions";
import { DEFAULT_PUBLIC_CONFIG, PublicSiteConfig } from "@/lib/types";
import { processImageInBrowser, ProcessedPhoto } from "@/lib/clientImageProcessor";
import {
  Lock,
  Upload,
  Layers,
  Palette,
  Star,
  Trash2,
  Edit,
  Loader2,
  CheckCircle2,
  Image as ImageIcon,
  AlertTriangle,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Clock,
  Play,
  Download,
} from "lucide-react";

function formatDuration(seconds?: number): string {
  if (!seconds || isNaN(seconds)) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function AdminStudioView() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [activeTab, setActiveTab] = useState<"albums" | "settings">("albums");

  const [albums, setAlbums] = useState<any[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("School Sports");
  const [photos, setPhotos] = useState<ProcessedPhoto[]>([]);
  const [coverPhotoUid, setCoverPhotoUid] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState("");

  // Drag and drop reordering state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const [siteConfig, setSiteConfig] = useState<PublicSiteConfig>(DEFAULT_PUBLIC_CONFIG);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  // Album Deletion Confirmation State
  const [albumToDelete, setAlbumToDelete] = useState<any | null>(null);
  const [isDeletingAlbum, setIsDeletingAlbum] = useState(false);

  // Import-from-family-site state
  const [importCandidates, setImportCandidates] = useState<any[]>([]);
  const [importListLoaded, setImportListLoaded] = useState(false);
  const [loadingImportList, setLoadingImportList] = useState(false);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [importingAlbums, setImportingAlbums] = useState(false);
  const [importResult, setImportResult] = useState<number | null>(null);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    checkAdminAuth().then((auth) => {
      setIsAuthenticated(auth);
      if (auth) {
        loadData();
      }
    });
  }, []);

  async function loadData() {
    setLoadingAlbums(true);
    const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.replace(/\/$/, "");
    try {
      const [albumsRes, configRes] = await Promise.all([
        fetch(`${baseUrl}/albums_public.json`, { cache: "no-store" }),
        fetch(`${baseUrl}/site_config_public.json`, { cache: "no-store" }),
      ]);

      if (albumsRes.ok) {
        const data = await albumsRes.json();
        setAlbums(data);
        // Discover every category used by published albums
        const seen = new Map<string, string>();
        for (const a of data) {
          const c = String(a.category || "").trim();
          if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
        }
        const discovered = [...seen.values()].sort();
        setAllCategories(discovered);
        if (discovered.length > 0) {
          setCategory((prev) => prev || discovered[0]);
        }
      }
      if (configRes.ok) {
        const cfg = await configRes.json();
        setSiteConfig({ ...DEFAULT_PUBLIC_CONFIG, ...cfg });
      }
    } catch (e) {
      console.error("Error loading admin data:", e);
    } finally {
      setLoadingAlbums(false);
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const res = await loginAdmin(password);
    if (res.success) {
      setIsAuthenticated(true);
      loadData();
    } else {
      setAuthError("Incorrect password");
    }
  };

  // --- Import from family site ---
  async function loadImportCandidates() {
    setLoadingImportList(true);
    setImportError("");
    setImportResult(null);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.replace(/\/$/, "");
      const [famRes, pubRes] = await Promise.all([
        fetch(`${baseUrl}/albums.json`, { cache: "no-store" }),
        fetch(`${baseUrl}/albums_public.json`, { cache: "no-store" }),
      ]);
      const family = famRes.ok ? await famRes.json() : [];
      const pub = pubRes.ok ? await pubRes.json() : [];
      const pubIds = new Set(
        (Array.isArray(pub) ? pub : []).map((a: any) => String(a?.id))
      );
      const candidates = (Array.isArray(family) ? family : []).filter(
        (a: any) => a && a.id && !pubIds.has(String(a.id))
      );
      setImportCandidates(candidates);
      // Pre-select everything — the common case is "bring it all over"
      setSelectedImportIds(new Set(candidates.map((a: any) => String(a.id))));
      setImportListLoaded(true);
    } catch (e) {
      console.error("Error loading family albums:", e);
      setImportError("Could not load the family album list. Please try again.");
    } finally {
      setLoadingImportList(false);
    }
  }

  function toggleImportId(id: string) {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAllImportSelected(selectAll: boolean) {
    setSelectedImportIds(
      selectAll
        ? new Set(importCandidates.map((a: any) => String(a.id)))
        : new Set()
    );
  }

  async function handleImportSelected() {
    if (selectedImportIds.size === 0 || importingAlbums) return;
    setImportingAlbums(true);
    setImportError("");
    setImportResult(null);
    try {
      const res = await importAlbumsFromFamily([...selectedImportIds]);
      if (!res.success) throw new Error(res.error || "Import failed");
      setImportResult(res.imported ?? 0);
      setSelectedImportIds(new Set());
      await loadData(); // refresh live albums + categories
      await loadImportCandidates(); // refresh the diff
    } catch (e: any) {
      setImportError(e?.message || "Import failed. Please try again.");
    } finally {
      setImportingAlbums(false);
    }
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadProgressText("Processing media in browser...");
    const processedList: ProcessedPhoto[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        try {
          const item = await processImageInBrowser(file);
          processedList.push(item);
        } catch (err: any) {
          console.error(`Error processing file ${file.name}:`, err);
        }
      }
    }

    // Sort new batch by shot timestamp
    processedList.sort((a, b) => a.timestamp - b.timestamp);

    setPhotos((prev) => {
      const combined = [...prev, ...processedList];
      combined.sort((a, b) => a.timestamp - b.timestamp);
      return combined;
    });
    setUploadProgressText("");
  }

  // Keep cover selection valid: default to the first photo when the selection
  // is empty or points at a photo that no longer exists; clear when emptied.
  useEffect(() => {
    if (photos.length === 0) {
      if (coverPhotoUid !== "") setCoverPhotoUid("");
      return;
    }
    if (!photos.some((p) => p.uid === coverPhotoUid)) {
      setCoverPhotoUid(photos[0].uid);
    }
  }, [photos, coverPhotoUid]);;

  // Reorder Handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIdx !== index) {
      setDragOverIdx(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIndex) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }

    setPhotos((prev) => {
      const updated = [...prev];
      const [movedItem] = updated.splice(draggedIdx, 1);
      updated.splice(targetIndex, 0, movedItem);
      return updated;
    });

    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const movePhotoStep = (fromIndex: number, direction: "left" | "right") => {
    const toIndex = direction === "left" ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= photos.length) return;

    setPhotos((prev) => {
      const updated = [...prev];
      const [movedItem] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, movedItem);
      return updated;
    });
  };

  const sortByTimestamp = () => {
    setPhotos((prev) => [...prev].sort((a, b) => a.timestamp - b.timestamp));
  };

  const handleCreateAlbum = async () => {
    if (!title.trim()) return alert("Please enter an Album Title.");
    if (photos.length === 0) return alert("Please select at least one photo or video.");

    setIsUploading(true);
    const baseUrl = process.env.NEXT_PUBLIC_R2_BASE_URL?.replace(/\/$/, "");

    try {
      // Public-site album IDs carry a pub- prefix (plus a random suffix) so they
      // can never collide with IDs generated by the original family site.
      const albumId = `pub-${date || new Date().toISOString().split("T")[0]}-${title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}-${Math.random().toString(36).slice(2, 6)}`;

      const uploadedPhotosData: any[] = [];

      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const isVideo = p.type === "video";
        const photoId = `${albumId}_${String(i + 1).padStart(3, "0")}`;
        setUploadProgressText(`Uploading ${isVideo ? "video" : "photo"} ${i + 1} of ${photos.length}...`);

        const thumbKey = `${albumId}/thumb/${photoId}.webp`;
        const displayKey = `${albumId}/display/${photoId}.webp`;
        const origExt = p.originalName.substring(p.originalName.lastIndexOf(".")) || (isVideo ? ".mp4" : ".jpg");
        const origKey = `${albumId}/original/${photoId}${origExt}`;
        const origMime = p.file.type || (isVideo ? "video/mp4" : "image/jpeg");

        const [thumbRes, displayRes, origRes] = await Promise.all([
          getDirectUploadUrl(thumbKey, "image/webp"),
          getDirectUploadUrl(displayKey, "image/webp"),
          getDirectUploadUrl(origKey, origMime),
        ]);

        if (!thumbRes.success || !thumbRes.url) throw new Error(thumbRes.error || "Failed to get thumb upload URL");
        if (!displayRes.success || !displayRes.url) throw new Error(displayRes.error || "Failed to get display upload URL");
        if (!origRes.success || !origRes.url) throw new Error(origRes.error || "Failed to get original upload URL");

        await Promise.all([
          fetch(thumbRes.url, { method: "PUT", body: p.thumbBlob, headers: { "Content-Type": "image/webp" } }),
          fetch(displayRes.url, { method: "PUT", body: p.displayBlob, headers: { "Content-Type": "image/webp" } }),
          fetch(origRes.url, { method: "PUT", body: p.file, headers: { "Content-Type": origMime } }),
        ]);

        uploadedPhotosData.push({
          id: photoId,
          original_filename: p.originalName,
          width: p.width,
          height: p.height,
          aspect_ratio: p.aspectRatio,
          type: p.type || "image",
          duration: p.duration,
          urls: {
            thumb: `${baseUrl}/${thumbKey}`,
            display: `${baseUrl}/${displayKey}`,
            original: `${baseUrl}/${origKey}`,
          },
          metadata: p.metadata,
        });
      }

      setUploadProgressText("Finalizing manifest & gallery indices...");

      const selectedCover = photos.find((p) => p.uid === coverPhotoUid);
      const coverIndex = selectedCover ? photos.indexOf(selectedCover) : 0;
      const finalCoverUrl = uploadedPhotosData[coverIndex]?.urls?.thumb || uploadedPhotosData[0]?.urls?.thumb;

      const createRes = await createAlbum({
        album_id: albumId,
        title,
        date: date || new Date().toISOString().split("T")[0],
        category,
        photos: uploadedPhotosData,
        cover_url: finalCoverUrl,
      });

      if (!createRes.success) {
        throw new Error(createRes.error || "Failed to save album metadata.");
      }

      setTitle("");
      setDate("");
      setPhotos([]);
      setCoverPhotoUid("");
      alert("Album successfully created and published!");
      loadData();
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || JSON.stringify(err);
      alert(`Upload failed: ${msg}`);
    } finally {
      setIsUploading(false);
      setUploadProgressText("");
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!albumToDelete) return;
    setIsDeletingAlbum(true);
    try {
      const res = await deleteAlbum(albumToDelete.id);
      if (res.success) {
        setAlbums((prev) => prev.filter((a) => a.id !== albumToDelete.id));
        setAlbumToDelete(null);
      } else {
        alert(`Delete failed: ${res.error || "Unknown error"}`);
      }
    } catch (err: any) {
      alert(`Delete error: ${err.message || String(err)}`);
    } finally {
      setIsDeletingAlbum(false);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsSuccess(false);
    try {
      const res = await savePublicSiteConfig(siteConfig);
      if (!res.success) throw new Error(res.error || "Save failed");
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 3000);
    } catch (err: any) {
      alert(`Failed to save settings: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleVisibleCategory = (cat: string) => {
    setSiteConfig((prev) => {
      const exists = prev.visible_categories.some(
        (c) => c.toLowerCase() === cat.toLowerCase()
      );
      return {
        ...prev,
        visible_categories: exists
          ? prev.visible_categories.filter((c) => c.toLowerCase() !== cat.toLowerCase())
          : [...prev.visible_categories, cat],
      };
    });
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-white">
        <Loader2 size={28} className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <form
          onSubmit={handleLogin}
          className="bg-neutral-900 border border-neutral-800 p-8 rounded-2xl w-full max-w-sm space-y-6 shadow-2xl"
        >
          <div className="flex items-center gap-3 text-white">
            <div className="p-2.5 rounded-xl bg-neutral-800 border border-neutral-700">
              <Lock size={20} className="text-blue-400" />
            </div>
            <div>
              <h1 className="font-bold text-lg">Admin Studio</h1>
              <p className="text-xs text-neutral-400">Enter password to manage gallery</p>
            </div>
          </div>

          <div className="space-y-2">
            <input
              type="password"
              placeholder="Admin Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500 transition"
              autoFocus
            />
            {authError && <p className="text-xs text-red-400">{authError}</p>}
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-sm transition cursor-pointer"
          >
            Unlock Studio
          </button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 pb-24">
      <header className="border-b border-neutral-800/80 sticky top-0 z-30 bg-neutral-950/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-lg text-white">Admin Studio</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-950 text-blue-300 border border-blue-800">
              Authenticated
            </span>
          </div>

          <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab("albums")}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "albums" ? "bg-neutral-800 text-white shadow-sm" : "text-neutral-400 hover:text-white"
              }`}
            >
              <Layers size={14} /> Albums &amp; Uploads
            </button>
            <button
              onClick={() => setActiveTab("settings")}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === "settings" ? "bg-neutral-800 text-white shadow-sm" : "text-neutral-400 hover:text-white"
              }`}
            >
              <Palette size={14} /> Site Design &amp; Categories
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-8 space-y-10">
        {activeTab === "albums" ? (
          <>
            <section className="bg-neutral-900/50 border border-neutral-800/80 rounded-2xl p-6 md:p-8 space-y-6">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Create New Album</h2>
                  <p className="text-xs text-neutral-400">Photos and videos are processed in-browser before upload</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300">Album Title</label>
                  <input
                    type="text"
                    placeholder="e.g. MS Baseball vs Charlotte Catholic"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-neutral-600"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300">Category / Group</label>
                  <input
                    type="text"
                    list="pub-category-suggestions"
                    placeholder="e.g. School Sports"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-neutral-600"
                  />
                  <datalist id="pub-category-suggestions">
                    {allCategories.map((cat) => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300">Event Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-neutral-600"
                  />
                </div>
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFiles(e.dataTransfer.files);
                }}
                onClick={() => document.getElementById("album-file-input")?.click()}
                className="border-2 border-dashed border-neutral-800 hover:border-neutral-600 bg-neutral-950/60 rounded-xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2"
              >
                <Upload size={28} className="text-neutral-500" />
                <p className="text-sm font-semibold text-neutral-300">Drag &amp; drop photos and videos here, or click to browse</p>
                <p className="text-xs text-neutral-500">Supports JPEG, PNG, MP4, MOV, and WebM</p>
                <input
                  id="album-file-input"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </div>

              {photos.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold text-neutral-200">
                        Selected Media ({photos.length})
                      </span>
                      <p className="text-[11px] text-neutral-400">
                        Drag cards to reorder action sequence • Hover for nudge arrows • Star sets cover
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={sortByTimestamp}
                        className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 transition"
                        title="Reset sequence to timestamp order"
                      >
                        <Clock size={12} />
                        <span>Sort by Time</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPhotos([])}
                        className="text-xs text-red-400 hover:underline"
                      >
                        Clear all
                      </button>
                    </div>
                  </div>

                  {/* Reorderable Media Grid */}
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                    {photos.map((p, idx) => {
                      const isCover = coverPhotoUid === p.uid;
                      const isDragged = draggedIdx === idx;
                      const isDragOver = dragOverIdx === idx;
                      const isVideo = p.type === "video";

                      return (
                        <div
                          key={p.uid}
                          draggable
                          onDragStart={(e) => handleDragStart(e, idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDrop={(e) => handleDrop(e, idx)}
                          onDragEnd={handleDragEnd}
                          className={`relative aspect-4/3 rounded-lg overflow-hidden border cursor-grab active:cursor-grabbing transition-all ${
                            isCover ? "border-amber-500 ring-2 ring-amber-500/40" : "border-neutral-800"
                          } ${isDragged ? "opacity-30 scale-95" : "opacity-100"} ${
                            isDragOver ? "border-blue-500 ring-2 ring-blue-500/50 scale-105" : ""
                          } bg-neutral-900 group`}
                        >
                          <img src={p.previewUrl} alt={p.originalName} className="w-full h-full object-cover pointer-events-none" />

                          {/* Sequence index badge */}
                          <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-md text-[10px] font-mono font-bold text-neutral-200 pointer-events-none">
                            #{idx + 1}
                          </div>

                          {/* Video Indicator */}
                          {isVideo && (
                            <div className="absolute bottom-1.5 left-8 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-md text-[10px] font-mono text-white pointer-events-none">
                              <Play size={8} className="fill-white text-white" />
                              {p.duration ? <span>{formatDuration(p.duration)}</span> : <span>VID</span>}
                            </div>
                          )}

                          {/* Cover Star and Delete */}
                          <button
                            type="button"
                            onClick={() => setCoverPhotoUid(p.uid)}
                            className={`absolute top-1.5 left-1.5 p-2 rounded-md backdrop-blur-md transition ${
                              isCover ? "bg-amber-500 text-black" : "bg-black/60 text-neutral-400 hover:text-white"
                            }`}
                            title="Set as Cover"
                          >
                            <Star size={11} fill={isCover ? "currentColor" : "none"} />
                          </button>

                          <button
                            type="button"
                            onClick={() => setPhotos(photos.filter((x) => x.uid !== p.uid))}
                            className="absolute top-1.5 right-1.5 p-2 rounded-md bg-black/60 text-neutral-400 hover:text-red-400 backdrop-blur-md sm:opacity-0 sm:group-hover:opacity-100 transition"
                            title="Remove"
                          >
                            <Trash2 size={11} />
                          </button>

                          {/* Center Drag Handle Visual Indicator */}
                          <div className="absolute inset-0 flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition pointer-events-none">
                            <span className="p-1 rounded-md bg-black/70 text-white backdrop-blur-sm shadow-md">
                              <GripVertical size={14} />
                            </span>
                          </div>

                          {/* Bottom Quick Nudge Arrows */}
                          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                movePhotoStep(idx, "left");
                              }}
                              className="p-1.5 rounded bg-black/70 hover:bg-neutral-800 disabled:opacity-30 text-white transition"
                              title="Move media earlier in sequence"
                            >
                              <ChevronLeft size={12} />
                            </button>
                            <button
                              type="button"
                              disabled={idx === photos.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                movePhotoStep(idx, "right");
                              }}
                              className="p-1.5 rounded bg-black/70 hover:bg-neutral-800 disabled:opacity-30 text-white transition"
                              title="Move media later in sequence"
                            >
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-4 flex items-center justify-end gap-4 border-t border-neutral-800">
                {uploadProgressText && (
                  <span className="text-xs text-neutral-400 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-blue-500" />
                    {uploadProgressText}
                  </span>
                )}
                <button
                  onClick={handleCreateAlbum}
                  disabled={isUploading}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition cursor-pointer"
                >
                  {isUploading ? "Uploading..." : "Publish Album"}
                </button>
              </div>
            </section>

            <section className="bg-neutral-900/50 border border-neutral-800/80 rounded-2xl p-6 md:p-8 space-y-6">
              <div className="border-b border-neutral-800 pb-4">
                <h2 className="text-lg font-bold text-white">Import from Family Site</h2>
                <p className="text-xs text-neutral-400">
                  Pull albums straight from the family site — no re-upload needed. Photos stay in the
                  shared bucket; only the album listing is copied over.
                </p>
              </div>

              {importError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-950/60 border border-red-800/60 text-red-300 text-xs">
                  <AlertTriangle size={14} className="shrink-0" /> {importError}
                </div>
              )}

              {importResult !== null && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-sm">
                  <CheckCircle2 size={16} className="shrink-0" />
                  {importResult > 0
                    ? `Imported ${importResult} album${importResult === 1 ? "" : "s"} to the public site.`
                    : "Nothing new to import — those albums are already on the public site."}
                </div>
              )}

              {!importListLoaded ? (
                <button
                  onClick={loadImportCandidates}
                  disabled={loadingImportList}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition cursor-pointer"
                >
                  {loadingImportList ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  {loadingImportList ? "Loading family albums..." : "Check for albums to import"}
                </button>
              ) : importCandidates.length === 0 ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <p className="text-xs text-neutral-500">
                    All family albums are already on the public site.
                  </p>
                  <button
                    onClick={loadImportCandidates}
                    disabled={loadingImportList}
                    className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition cursor-pointer shrink-0"
                  >
                    Check again
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-neutral-400">
                      {importCandidates.length} album{importCandidates.length === 1 ? "" : "s"} available
                      • {selectedImportIds.size} selected
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setAllImportSelected(true)}
                        className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition cursor-pointer"
                      >
                        Select all
                      </button>
                      <button
                        onClick={() => setAllImportSelected(false)}
                        className="text-xs font-semibold text-neutral-400 hover:text-white transition cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {importCandidates.map((album: any) => {
                      const id = String(album.id);
                      const checked = selectedImportIds.has(id);
                      return (
                        <label
                          key={id}
                          className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                            checked
                              ? "bg-blue-950/40 border-blue-800/60"
                              : "bg-neutral-900 border-neutral-800 hover:border-neutral-700"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleImportId(id)}
                            className="w-5 h-5 accent-blue-600 shrink-0 cursor-pointer"
                          />
                          <div className="w-12 h-12 rounded-lg overflow-hidden bg-neutral-950 shrink-0">
                            {album.cover_url ? (
                              <img src={album.cover_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-neutral-700">
                                <ImageIcon size={18} />
                              </div>
                            )}
                          </div>
                          <div className="truncate min-w-0">
                            <p className="text-xs font-semibold text-white truncate">{album.title}</p>
                            <p className="text-[11px] text-neutral-400 truncate">
                              {album.date || "No date"} • {album.category || "Uncategorized"} •{" "}
                              {album.photo_count ?? 0} items
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <button
                    onClick={handleImportSelected}
                    disabled={selectedImportIds.size === 0 || importingAlbums}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition cursor-pointer"
                  >
                    {importingAlbums ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Download size={16} />
                    )}
                    {importingAlbums
                      ? "Importing..."
                      : `Import selected (${selectedImportIds.size})`}
                  </button>
                </div>
              )}
            </section>

            <section className="space-y-4">
              <h2 className="text-base font-bold text-white">Live Albums ({albums.length})</h2>
              {loadingAlbums ? (
                <div className="flex items-center gap-2 text-xs text-neutral-400 py-6">
                  <Loader2 size={16} className="animate-spin text-blue-500" /> Loading albums...
                </div>
              ) : albums.length === 0 ? (
                <p className="text-xs text-neutral-500 py-4">No albums published yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {albums.map((album) => (
                    <div
                      key={album.id}
                      className="flex items-center justify-between p-3.5 bg-neutral-900 border border-neutral-800 rounded-xl"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-neutral-950 shrink-0">
                          {album.cover_url ? (
                            <img src={album.cover_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-700">
                              <ImageIcon size={18} />
                            </div>
                          )}
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-semibold text-white truncate">{album.title}</p>
                          <p className="text-[11px] text-neutral-400">{album.category || "School Sports"} • {album.photo_count} items</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Link
                          href={`/admin/edit/${album.id}`}
                          className="p-2.5 text-neutral-400 hover:text-white rounded-lg bg-neutral-800 hover:bg-neutral-700 transition"
                          title="Edit Album"
                        >
                          <Edit size={14} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setAlbumToDelete(album)}
                          className="p-2.5 text-neutral-400 hover:text-red-400 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition cursor-pointer"
                          title="Delete Album"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="bg-neutral-900/50 border border-neutral-800/80 rounded-2xl p-6 md:p-8 space-y-8 max-w-3xl">
            <div>
              <h2 className="text-lg font-bold text-white">Site Design &amp; Categories</h2>
              <p className="text-xs text-neutral-400">Configure global hero titles, presets, and category folder tabs</p>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Homepage Text</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-neutral-300 font-semibold block mb-1">Site Title</label>
                  <input
                    type="text"
                    value={siteConfig.site_title}
                    onChange={(e) => setSiteConfig({ ...siteConfig, site_title: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-neutral-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-300 font-semibold block mb-1">Badge Text</label>
                  <input
                    type="text"
                    value={siteConfig.badge_text}
                    onChange={(e) => setSiteConfig({ ...siteConfig, badge_text: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-neutral-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-300 font-semibold block mb-1">Hero Headline</label>
                  <input
                    type="text"
                    value={siteConfig.hero_headline}
                    onChange={(e) => setSiteConfig({ ...siteConfig, hero_headline: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-neutral-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-300 font-semibold block mb-1">Hero Description</label>
                  <input
                    type="text"
                    value={siteConfig.hero_description}
                    onChange={(e) => setSiteConfig({ ...siteConfig, hero_description: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-neutral-600"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Theme Atmosphere</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { id: "slate-glow", name: "Slate Glow", color: "bg-blue-950" },
                  { id: "midnight-sports", name: "Midnight", color: "bg-indigo-950" },
                  { id: "deep-emerald", name: "Emerald", color: "bg-emerald-950" },
                  { id: "carbon-minimal", name: "Carbon", color: "bg-neutral-950" },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSiteConfig({ ...siteConfig, theme_preset: t.id })}
                    className={`p-3 rounded-xl border text-left transition ${
                      siteConfig.theme_preset === t.id
                        ? "border-blue-500 bg-neutral-800/80 ring-2 ring-blue-500/20"
                        : "border-neutral-800 bg-neutral-950/40 hover:border-neutral-700"
                    }`}
                  >
                    <div className={`w-full h-8 rounded-md mb-2 ${t.color}`} />
                    <p className="text-xs font-semibold text-white">{t.name}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Visible Categories</h3>
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                Only albums in the checked categories appear on this public site. Albums in
                any other category stay private to this site&apos;s admin — this is how
                family-only albums are kept off the public gallery.
              </p>
              {allCategories.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  No categories discovered yet — publish an album first, then choose which
                  categories to make public here.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {allCategories.map((cat) => {
                    const checked = siteConfig.visible_categories.some(
                      (c) => c.toLowerCase() === cat.toLowerCase()
                    );
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleVisibleCategory(cat)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold border transition cursor-pointer ${
                          checked
                            ? "bg-blue-950/60 border-blue-700/60 text-blue-200"
                            : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-600"
                        }`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                            checked ? "bg-blue-600 border-blue-500 text-white" : "border-neutral-700"
                          }`}
                        >
                          {checked && <CheckCircle2 size={11} />}
                        </span>
                        {cat}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Homepage Showcase</h3>
              <div className="max-w-sm space-y-1.5">
                <label className="text-xs text-neutral-300 font-semibold block">
                  Number of latest albums shown on the homepage
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={siteConfig.latest_count}
                  onChange={(e) =>
                    setSiteConfig({
                      ...siteConfig,
                      latest_count: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                    })
                  }
                  className="w-28 px-3 py-1.5 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-white focus:outline-none focus:border-neutral-600"
                />
              </div>
            </div>

            <div className="pt-4 flex items-center justify-end gap-3 border-t border-neutral-800">
              {settingsSuccess && (
                <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> Settings Saved!
                </span>
              )}
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition cursor-pointer"
              >
                {savingSettings ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </section>
        )}
      </main>

      {/* Confirmation Dialog */}
      {albumToDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !isDeletingAlbum && setAlbumToDelete(null)}
        >
          <div
            className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-6 space-y-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-red-950/60 border border-red-800/80 text-red-400 rounded-xl shrink-0">
                <AlertTriangle size={22} />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">Delete Album</h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Are you sure you want to permanently delete{" "}
                  <span className="text-white font-semibold">&quot;{albumToDelete.title}&quot;</span>?
                  This removes the album from the public directory.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setAlbumToDelete(null)}
                disabled={isDeletingAlbum}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-lg text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirmed}
                disabled={isDeletingAlbum}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
              >
                {isDeletingAlbum && <Loader2 size={13} className="animate-spin" />}
                {isDeletingAlbum ? "Deleting..." : "Delete Album"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
