# BECK / PHOTO — Public Site

The public companion to the family photo site (`beck-photo-site`). Same visual
DNA and the same photo bucket — but built for sharing with people outside the
family, with its own branding config, a category system that scales, and a
shareable "latest uploads" page.

The original site is untouched. Uploads keep happening on the original site's
admin; this site only reads.

## How the two sites share data

Both sites read from the **same Cloudflare R2 bucket**:

| File in bucket | Used by |
|---|---|
| `albums.json` | Both — the shared album index (newest first). Written only by the original site's admin. |
| `<album-id>/manifest.json` | Both — per-album photo lists. Written only by the original site's admin. |
| `site_config.json` | Original (family) site only. |
| `site_config_public.json` | **This site only.** Edited in this site's `/admin`. |

This site never writes to `albums.json` or any manifest. Its only write is
`site_config_public.json` via the password-gated `/admin` page.

## Family vs. public album separation

Separation is driven by the `visible_categories` array in
`site_config_public.json`:

- An album appears on the public site **only if** its `category`
  (case-insensitive) is listed in `visible_categories`.
- Albums in any other category (e.g. `Family`) are invisible here — homepage,
  category pages, and `/latest` all filter on it. Requesting a hidden
  category URL returns a generic not-found page.
- **Fail-safe default:** if `site_config_public.json` does not exist yet,
  `visible_categories` is empty and the public site shows nothing until the
  owner picks categories in `/admin`.

To publish a new category publicly: upload the album on the family site as
usual, then check the category in this site's `/admin` → Visible categories →
Save.

## Pages

- `/` — Homepage: hero, horizontally scrollable category pill bar (scales to
  15+ categories), recent albums grid.
- `/latest` — **The shareable page.** Shows only the N most recent public
  albums (N = `latest_count` in the config, default 10). Share this URL
  instead of the full site when you only want people to see new uploads.
- `/category/[slug]` — Category gallery (ported from the original).
- `/album/[...id]` — Album viewer with downloads, slideshow, and per-album
  share modal (ported from the original; viewer-presence badge removed).
- `/admin` — Password-gated settings: branding text, visible categories
  (checkboxes discovered from `albums.json`), and the `/latest` count.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_R2_BASE_URL` | Build + runtime | Public base URL of the R2 bucket, e.g. `https://pub-xxxx.r2.dev`. Used for all public reads (`albums.json`, manifests, `site_config_public.json`). |
| `R2_ENDPOINT` | Server only | S3 API endpoint, e.g. `https://<account-id>.r2.cloudflarestorage.com`. Needed only for `/admin` saves. |
| `R2_ACCESS_KEY_ID` | Server only | R2 API token key. Needed only for `/admin` saves. |
| `R2_SECRET_ACCESS_KEY` | Server only | R2 API token secret. Needed only for `/admin` saves. |
| `R2_BUCKET_NAME` | Server only | Bucket name (same bucket the family site uses). Needed only for `/admin` saves. |
| `ADMIN_PASSWORD` | Server only | Password for `/admin`. No default that matters — set a strong one in Vercel. |

Without the `R2_*` / `ADMIN_PASSWORD` vars the site still runs fine; only
`/admin` saves are disabled.

## Local development

```bash
npm install
# copy env
cp .env.example .env.local   # then fill in NEXT_PUBLIC_R2_BASE_URL at minimum
npm run dev
```

## Deploy on Vercel

1. Push this directory to a new GitHub repo (e.g. `beck-photo-public`).
2. In Vercel: **Add New Project** → import the repo. Framework preset: Next.js.
3. Add the environment variables above (all of them for a working `/admin`).
4. Deploy. Note the new URL (e.g. `beck-photo-public.vercel.app`).
5. Visit `/admin`, sign in, and check the categories you want public. Save.

The original family site keeps its own Vercel project and URL — nothing changes
there.
