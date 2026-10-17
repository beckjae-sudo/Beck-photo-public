"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lock,
  Save,
  LogOut,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw,
  Check,
} from "lucide-react";
import {
  checkAdminAuth,
  loginAdmin,
  logoutAdmin,
  getAdminData,
  savePublicSiteConfig,
} from "@/app/admin/actions";
import { PublicSiteConfig, DEFAULT_PUBLIC_CONFIG } from "@/lib/types";

export default function AdminPanel() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<PublicSiteConfig>(DEFAULT_PUBLIC_CONFIG);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    checkAdminAuth().then((ok) => {
      setAuthed(ok);
      setAuthChecked(true);
      if (ok) loadData();
    });
  }, []);

  const loadData = async () => {
    setLoading(true);
    const res = await getAdminData();
    setLoading(false);
    if (res.success && res.config) {
      setConfig(res.config);
      setAllCategories(res.allCategories || []);
    } else {
      setAuthed(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    const res = await loginAdmin(password);
    setLoggingIn(false);
    if (res.success) {
      setAuthed(true);
      setPassword("");
      loadData();
    } else {
      setLoginError("Incorrect password.");
    }
  };

  const handleLogout = async () => {
    await logoutAdmin();
    setAuthed(false);
    router.refresh();
  };

  const toggleCategory = (cat: string) => {
    setConfig((prev) => {
      const has = prev.visible_categories.some(
        (c) => c.toLowerCase() === cat.toLowerCase()
      );
      return {
        ...prev,
        visible_categories: has
          ? prev.visible_categories.filter((c) => c.toLowerCase() !== cat.toLowerCase())
          : [...prev.visible_categories, cat],
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    const res = await savePublicSiteConfig(config);
    setSaving(false);
    setSaveMsg(
      res.success
        ? { ok: true, text: "Saved. Changes go live on the next page load." }
        : { ok: false, text: res.error || "Save failed." }
    );
  };

  const set = (k: keyof PublicSiteConfig) => (v: string | number) =>
    setConfig((prev) => ({ ...prev, [k]: v }));

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-neutral-500" size={24} />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-6 select-none">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8"
        >
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-blue-950/60 border border-blue-800/60 text-blue-400">
              <Lock size={16} />
            </span>
            <div>
              <h1 className="text-sm font-bold uppercase font-mono tracking-wider text-white">
                Site Admin
              </h1>
              <p className="text-[11px] text-neutral-500 font-mono">
                beck-photo-public
              </p>
            </div>
          </div>

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              autoFocus
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-600 pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {loginError && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle size={13} /> {loginError}
            </p>
          )}

          <button
            type="submit"
            disabled={loggingIn || !password}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold transition flex items-center justify-center gap-2"
          >
            {loggingIn && <Loader2 size={15} className="animate-spin" />}
            Sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 select-none">
      <header className="border-b border-neutral-800/60 bg-neutral-950/80 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold uppercase font-mono tracking-wider text-white">
              Public Site Settings
            </h1>
            <p className="text-[11px] text-neutral-500 font-mono">
              site_config_public.json — shared R2 bucket
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
              title="Reload"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs font-mono text-neutral-400 hover:text-white py-2 px-3 rounded-lg hover:bg-neutral-800 border border-neutral-800 transition"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-neutral-500" size={24} />
          </div>
        ) : (
          <>
            <section className="space-y-4">
              <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                Branding
              </h2>
              <div className="grid gap-4">
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-mono text-neutral-500 uppercase">Site title</span>
                  <input
                    value={config.site_title}
                    onChange={(e) => set("site_title")(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-600"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-mono text-neutral-500 uppercase">Badge text</span>
                  <input
                    value={config.badge_text}
                    onChange={(e) => set("badge_text")(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-600"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-mono text-neutral-500 uppercase">Hero headline</span>
                  <input
                    value={config.hero_headline}
                    onChange={(e) => set("hero_headline")(e.target.value)}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-600"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-mono text-neutral-500 uppercase">Hero description</span>
                  <textarea
                    value={config.hero_description}
                    onChange={(e) => set("hero_description")(e.target.value)}
                    rows={3}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-600 resize-y"
                  />
                </label>
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                  Visible categories
                </h2>
                <p className="text-[11px] text-neutral-500 mt-1 max-w-xl">
                  Only checked categories appear on the public site — homepage,
                  category pages, and /latest. Albums in unchecked categories
                  stay visible on the family site only.
                </p>
              </div>
              {allCategories.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {allCategories.map((cat) => {
                    const checked = config.visible_categories.some(
                      (c) => c.toLowerCase() === cat.toLowerCase()
                    );
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className={`px-4 py-2 rounded-full text-xs font-mono uppercase tracking-wider border transition flex items-center gap-1.5 ${
                          checked
                            ? "bg-blue-600 border-blue-500 text-white"
                            : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
                        }`}
                      >
                        {checked && <Check size={13} />}{cat}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-neutral-500">
                  No categories found in albums.json yet.
                </p>
              )}
              <p className="text-[11px] font-mono text-neutral-600">
                {config.visible_categories.length} of {allCategories.length} categories public
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                Latest page
              </h2>
              <label className="block space-y-1.5 max-w-xs">
                <span className="text-[11px] font-mono text-neutral-500 uppercase">
                  Albums shown on /latest
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={config.latest_count}
                  onChange={(e) => set("latest_count")(Number(e.target.value) || 10)}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-600"
                />
              </label>
            </section>

            <div className="sticky bottom-0 py-4 bg-gradient-to-t from-neutral-950 via-neutral-950/95 to-transparent">
              {saveMsg && (
                <p
                  className={`mb-3 text-xs flex items-center gap-1.5 ${
                    saveMsg.ok ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {saveMsg.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {saveMsg.text}
                </p>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                Save public site config
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
