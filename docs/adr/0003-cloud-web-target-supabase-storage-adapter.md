# Cloud web target: shared SPA over a storage-adapter seam, Supabase backend

## Context

FlagLabel ships as a Tauri desktop app that reads a local image folder and
writes one schema-v2 JSON file per image to disk. The team wants a **no-install,
browser-based version backed by a shared central dataset** so multiple labelers
can work the same project without each maintaining their own copy of the photos.
Browsers cannot roam the local filesystem the way the Tauri/Rust commands do, so
"put it on the web" is really a decision about *where images and annotations live*
and *how the existing code reaches them*. The desktop app is to remain in service
alongside the web version.

## Decision

Add a **web deployment target that shares one codebase with the desktop app**,
introducing a `StorageBackend` seam — a single interface (`listImages`,
`readAnnotations`, `writeAnnotations`, plus image-URL resolution) with two
implementations:

- **Tauri/filesystem** — the existing `list_images_in_dir` / `read_text_file` /
  `write_text_file` commands + `convertFileSrc`. Unchanged. Desktop only,
  no auth, offline.
- **Supabase** — used by the web build. The whole `src/annotations/` core and the
  React/canvas UI stay shared between both backends.

The web build is a **static Vite SPA** (no Next.js — see Considered options),
deployed to **Vercel** (GitHub-connected, push-to-deploy), with the Supabase
project URL + anon key as build-time env vars.

**Supabase** is the single backend, used for:

- **Auth** — email + password, **invite-only** (no public signup); accounts are
  created by the admin. Supabase Auth runs client-side in the SPA.
- **Row-Level Security (RLS)** — **on, as a hard requirement.** The anon key is
  public by design; RLS is the actual data gate (authenticated team members only).
- **Storage** — image files mirrored as `photos/<camera>/IMG_xxxx.JPG`, preserving
  the `cam0X` folder names so `site` = camera (see CONTEXT.md). At ~680 KB/image
  and a couple hundred images (~150 MB), this fits the Supabase **free tier**.
- **Postgres** — annotation storage, **hybrid model**: the schema-v2 object is
  stored verbatim as a `jsonb` blob (the single source of truth, built/parsed by
  the unchanged `src/annotations/schema.ts`), alongside a few derived summary
  columns (`labeler`, `status`, `annotation_count`, `updated_at`) for team-progress
  views. Labels are only ever mutated **through the app** using the existing pure
  `src/annotations/` helpers — never via raw SQL.
- **Realtime Presence** — drives soft per-image **edit locks**: opening an image
  claims it ("🔒 in use by X"); others may open it **read-only** but cannot edit.
  A **heartbeat (~20–30 s) with ~2 min auto-expire** frees abandoned locks
  (crash / closed laptop / dead wifi self-heal), with an **admin force-unlock**
  as a manual safety valve.

**Download** of annotations is preserved as both **per-image** and **bulk ZIP**,
each producing the exact `<site>__<imagestem>.json` filenames and byte-identical
schema-v2 content as the desktop app — the downstream distance pipeline cannot
tell which app produced a file.

Image ingest is an **in-app, admin-only upload screen** (drag a camera folder →
uploads to Storage + seeds rows), repeatable per survey.

## Considered options

- **Web replaces desktop entirely.** Rejected: the local-folder/offline workflow
  and installed app are still wanted; the adapter seam keeps both for a small
  refactor cost (the Tauri coupling is ~6 call sites in `App.tsx`).
- **Separate web codebase (fork).** Rejected: duplicates the ~2400-line annotation
  UI and forces every feature to be built twice.
- **Next.js + NextAuth for the web.** Rejected: Next.js/App-Router/server-components
  don't run inside Tauri cleanly, so it would force a separate codebase (the fork
  above); NextAuth needs a server and would have to be manually bridged to Supabase
  RLS. The app is a behind-login canvas tool with no SSR/SEO benefit. Supabase Auth
  on the existing SPA keeps one codebase and unifies auth with RLS.
- **Normalized annotation rows (one row per annotation).** Rejected: requires a
  second representation that can drift from the desktop format, and forces JSON
  *reconstruction* on every download. The blob keeps a single source of truth and
  makes download trivial. (The one thing normalized rows win at — ad-hoc cross-
  dataset SQL surgery — is not needed, since editing is through the app.)
- **Per-image JSON blob with no summary columns.** Rejected: makes the team-progress
  view (a primary reason for going central) awkward JSONB digging.
- **Images in cheaper external object storage (R2/B2) or referenced in place.**
  Rejected as over-engineering once measured: ~150 MB fits the Supabase free tier,
  so one vendor is simpler.
- **Assignment-by-camera or free-for-all instead of locks.** Free-for-all leaves the
  blob's last-write-wins clobber risk live; assignment avoids it by convention. Soft
  locks were chosen to make same-image collision *impossible* with live visibility.
- **Explicit-release-only locks (no heartbeat).** Rejected: a browser that dies mid-
  edit never releases, permanently stranding the image.

## Consequences

- The desktop app is unaffected — it keeps the filesystem backend, no auth, offline.
- The web build leaks the Supabase URL + anon key publicly; **RLS being correct is
  load-bearing for data security**, not optional.
- Last-write-wins still applies *within* a single image's blob; the soft lock is what
  prevents two editors from colliding, so the lock + heartbeat must be correct.
- Bulk edits/migrations across the dataset must go through code that reuses
  `src/annotations/` (an Edge Function or the app), not raw SQL, to avoid format drift.
