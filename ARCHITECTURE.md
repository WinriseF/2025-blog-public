# Project Architecture

Last updated: 2026-07-09.

This document is written for future AI agents and maintainers. Read it before doing broad scans of the project.

## What This Project Is

`2025-blog-public` is a personal content site built with Next.js App Router. The core model is:

- Static, versioned content files in this repository.
- A rich client-side frontend for reading, browsing, and visual presentation.
- Content maintained by editing repository files and submitting normal code commits.
- A small amount of server-side routing for RSS and news proxy/parsing.
- A separate Supabase Edge Function for likes.
- An encrypted message/file transfer tool backed by EdgeOne Edge Functions and Pages Blob, plus LAN transfer signaling backed by Supabase Realtime Presence and Broadcast.

This is not a traditional CMS-backed blog. Content is JSON, Markdown, and image references committed to the repo.

## Technology Stack

Primary stack:

- Next.js 16 with App Router.
- React 19.
- TypeScript with `strict: true`.
- Tailwind CSS 4.
- Zustand for client state stores.
- SWR for client-side data fetching and cache behavior.
- `marked`, `shiki`, `mermaid`, and `html-react-parser` for Markdown rendering.
- `motion` for animation.
- `lucide-react` and local SVG files for icons.
- `interactjs` for pointer-based drag/resize interactions in the face privacy masking tool.
- `qrcode` for browser-side QR code generation in the transfer toolbox.
- `simple-peer` for browser-side LAN transfer WebRTC sessions.
- Netlify deployment through `@netlify/plugin-nextjs`.
- Supabase Edge Function for the like endpoint and Supabase Realtime Presence and Broadcast for LAN transfer signaling.
- EdgeOne Edge Functions and Pages Blob for the encrypted message transfer toolbox feature.

Important config files:

- `package.json`: dependencies and scripts.
- `next.config.ts`: Next config, SVG handling, redirects, React Compiler.
- `tsconfig.json`: TypeScript config and `@/*` path alias.
- `netlify.toml`: Netlify build and cache headers.
- `edgeone.json`: EdgeOne scheduled cleanup for the transfer function.

Important note: `next.config.ts` currently has `typescript.ignoreBuildErrors: true`. Do not assume production builds catch TypeScript errors.

## High-Level Directory Map

- `src/app/`: Next.js routes, route handlers, and route-local modules.
- `src/components/`: shared React components.
- `src/hooks/`: shared client hooks.
- `src/lib/`: business utilities, renderers, clients, parsers, and shared logic.
- `src/config/`: site config JSON.
- `src/layout/`: global layout shell used by `src/app/layout.tsx`.
- `src/styles/`: global Tailwind/CSS and article styles.
- `src/svgs/`: local SVG assets imported as React components.
- `public/blogs/`: blog content, blog index, generated word-cloud data.
- `public/images/`: local image paths mirrored from the image repository when present.
- `scripts/`: build-time helper scripts.
- `supabase/`: like function and database migration.
- `edge-functions/`: EdgeOne Edge Functions used by the transfer toolbox.

## Global App Shell

Root layout:

- `src/app/layout.tsx`
- `src/layout/index.tsx`
- `src/layout/head.tsx`

`src/app/layout.tsx` imports global CSS, reads `src/config/site-content.json`, sets metadata, injects theme CSS variables, and wraps all routes in `Layout`.

`src/layout/index.tsx` is a client component. It provides:

- `TimeThemeProvider`
- `MusicPlayerProvider`
- Sonner toaster
- animated time atmosphere background
- global `NavCard`
- mobile scroll-to-top button
- special desktop homepage scale fitting

Because the global layout is strongly client-driven, many pages depend on browser runtime behavior.

## Routing Overview

Main route groups and pages:

- `/`: homepage from `src/app/(home)/page.tsx`.
- `/home`: alternate/extra home route in `src/app/home/`.
- `/blog`: blog index from `src/app/blog/page.tsx`.
- `/blog/[id]`: blog detail from `src/app/blog/[id]/page.tsx`.
- `/projects`: projects grid from `src/app/projects/`.
- `/pictures`: image gallery from `src/app/pictures/`.
- `/share`: shared links/resources from `src/app/share/`.
- `/bloggers`: blogroll from `src/app/bloggers/`.
- `/about`: about page from `src/app/about/`.
- `/news` and `/news/[date]`: news index/detail.
- `/calendar`, `/world-clock`, `/music`, `/game`, `/svgs`: utility or experimental pages.
- `/toolbox`: toolbox directory page with links to `/toolbox/compress`, `/toolbox/markdown`, `/toolbox/face-mask`, and `/t`.
- `/toolbox/compress`: image compression tool.
- `/toolbox/markdown`: local Markdown preview tool.
- `/toolbox/face-mask`: local privacy masking tool for face detection, manual rectangular masks, and original-size image export.
- `/t`, `/t/[code]`, and `/t/status`: public encrypted transfer, LAN transfer, and relay storage status entrypoints.
- `/rss.xml`: RSS route implemented in `src/app/rss.xml/route.ts`.

There are empty route directories for `src/app/sitemap.xml` and `src/app/robots.txt` at the time of this document. They do not currently implement routes.

## Content Model

### Blog Content

Blog content lives under `public/blogs/`.

Each blog uses this structure:

```txt
public/blogs/<slug>/
  config.json
  index.md
```

Global blog files:

- `public/blogs/index.json`: list of blog metadata used by the blog index and RSS.
- `public/blogs/word-cloud.json`: generated by `scripts/generate-word-cloud.cjs`.

Blog config shape is represented in `src/lib/load-blog.ts`:

- `title`
- `tags`
- `date`
- `summary`
- optional `cover`

### Other Content Lists

Several sections are JSON-driven and colocated with their routes:

- `src/app/projects/list.json`
- `src/app/pictures/list.json`
- `src/app/share/list.json`
- `src/app/bloggers/list.json`
- `src/app/about/list.json`

Global site and homepage config:

- `src/config/site-content.json`
- `src/config/card-styles.json`
- `src/config/card-styles-default.json`

## Blog Read Flow

Blog index flow:

1. `src/app/blog/page.tsx` calls `useBlogIndex`.
2. `src/hooks/use-blog-index.ts` fetches `/blogs/index.json`.
3. SWR and localStorage cache the index.
4. The page groups entries by year and can switch between list view and word-cloud view.

Blog detail flow:

1. `src/app/blog/[id]/page.tsx` reads the slug from route params.
2. It calls `loadBlog(slug)` from `src/lib/load-blog.ts`.
3. `loadBlog` fetches `/blogs/<slug>/config.json` and `/blogs/<slug>/index.md`.
4. The page renders `BlogPreview`.
5. `BlogPreview` calls `useMarkdownRender`.
6. The article is displayed with `BlogSidebar`, `ReadingProgressBar`, code blocks, images, and TOC.

Important: blog detail content is currently fetched and rendered on the client, not statically rendered as full article HTML by the server.

## Markdown Rendering Pipeline

Relevant files:

- `src/lib/markdown-renderer.ts`
- `src/lib/markdown.worker.ts`
- `src/hooks/use-markdown-render.tsx`
- `src/components/blog-preview.tsx`
- `src/components/code-block.tsx`
- `src/components/markdown-image.tsx`
- `src/components/mermaid-diagram.tsx`

Pipeline:

1. Markdown text enters `useMarkdownRender`.
2. Rendering usually runs in a Web Worker through `markdown.worker.ts`.
3. `renderMarkdown` uses `marked` to lex/parse Markdown.
4. Headings are scanned into a TOC.
5. Code blocks are highlighted with `shiki`.
6. HTML is parsed back into React elements by `html-react-parser`.
7. External links receive safe target attributes.
8. `<img>` nodes are replaced with `MarkdownImage`.
9. Shiki code blocks are wrapped with `CodeBlock` for UI features such as copy.
10. Fenced `mermaid` code blocks are emitted as placeholders by the worker renderer and rendered on the client by `MermaidDiagram`; keep text-only command output, file trees, conflict examples, and raw object examples as ordinary code blocks.

## Homepage Architecture

Homepage route:

- `src/app/(home)/page.tsx`

Key modules:

- `src/app/(home)/stores/config-store.ts`
- `src/app/(home)/theme-toggle-card.tsx`
- `src/config/site-content.json`
- `src/config/card-styles.json`

The homepage is a card-based dashboard/personal page. Cards read dimensions, order, enabled state, and offsets from `card-styles.json`. The config store loads site content and card styles into Zustand. Homepage layout and card content are edited through repository files, not through an in-browser admin dialog.

## Navigation

Global navigation is `src/components/nav-card.tsx`.

It is rendered by the global layout on all pages. It adapts between:

- full card mode on the homepage,
- icon strip mode on other routes and mobile.

Navigation items are currently hardcoded inside `nav-card.tsx`.

## Content Maintenance

The project does not expose in-browser editing, deletion, or repository mutation flows. Public pages for blogs, projects, pictures, shares, bloggers, about, and the homepage are read-only displays over committed files.

Maintenance model:

1. Edit JSON, Markdown, and config files directly in the repository.
2. Keep image assets in the sibling image repository described below, then mirror/runtime-reference the intended public paths.
3. Update generated artifacts only through the project script when the user explicitly asks or the artifact itself is the requested output.
4. Submit changes through normal code commits and deployment.

## Image And Asset Model

Project instruction policy: source images should be maintained in the sibling image repository:

```txt
E:\Project\PROJECT\2025-blog-img
```

Do not add new image assets directly under `2025-blog-public/public/` unless the project instruction changes.

Path mapping:

- `2025-blog-img/blogs/<slug>/` corresponds to `2025-blog-public/public/blogs/<slug>/`.
- `2025-blog-img/images/` corresponds to `2025-blog-public/public/images/`.

Runtime asset helper:

- `src/lib/asset-url.ts`

`getAssetUrl('/images/avatar.png')` prefixes paths with `NEXT_PUBLIC_ASSET_ORIGIN` or the default `https://img.winrisef.top`.

Image display helper:

- `src/components/optimized-image.tsx`

This is a thin native `<img>` wrapper, not Next Image.

## News Architecture

News logic:

- `src/lib/news.ts`

API routes:

- `src/app/api/news/[date]/route.ts`
- `src/app/api/newsnow/focus/route.ts`

Pages:

- `src/app/news/page.tsx`
- `src/app/news/[date]/page.tsx`
- `src/app/news/newsnow-live-section.tsx`

Data sources:

- `NEWS_BILI_BASE_URL`, default `https://img.winrisef.top/news/bili`
- `NEWSNOW_BASE_URL`, default `https://newsnow.busiyi.world`

The server-side route handlers fetch remote Markdown/API data, normalize it, and return JSON with cache headers. This keeps third-party source parsing out of most page components.

## RSS, Sitemap, Robots

RSS:

- Implemented in `src/app/rss.xml/route.ts`.
- Reads `src/config/site-content.json` and `public/blogs/index.json`.
- Exports a static RSS XML response.

Sitemap and robots:

- `src/app/sitemap.xml` and `src/app/robots.txt` directories exist but are empty at the time of this document.
- Do not assume sitemap or robots are implemented.

## Likes

Frontend:

- `src/components/like-button.tsx`

Backend:

- `supabase/functions/like/index.ts`
- `supabase/migrations/20260418_create_likes.sql`

Flow:

1. Frontend reads `NEXT_PUBLIC_LIKE_ENDPOINT`.
2. GET returns the current like count for a slug.
3. POST records a daily slug/ip hash limit and increments the count.
4. Supabase function uses `SUPABASE_SERVICE_ROLE_KEY` inside the Edge Function environment.

Privileged credentials live server-side inside the Supabase Edge Function environment.

## Message Transfer Toolbox

Frontend:

- `src/app/toolbox/toolbox-client.tsx`
- `src/app/toolbox/tool-page-shell.tsx`
- `src/app/toolbox/compress-tool.tsx`
- `src/app/toolbox/markdown-tool.tsx`
- `src/app/toolbox/transfer-tool.tsx`
- `src/app/toolbox/lan-transfer-tool.tsx`
- `src/app/t/transfer-page-client.tsx`
- `src/lib/lan-transfer/`
- `src/lib/transfer-crypto.ts`
- `src/lib/transfer-relay.ts`

Backend:

- `edge-functions/api/transfer/[[default]].js`
- `edge-functions/api/transfer/admin.js`
- `edge-functions/api/transfer/cos-download-url.js`
- `edgeone.json`

Encrypted relay flow:

1. User creates a text or file transfer from `/t`.
2. The browser derives an AES-GCM key from the password with fixed PBKDF2-SHA256 settings and encrypts the payload locally.
3. The browser calls `${NEXT_PUBLIC_TRANSFER_API_BASE}/api/transfer/create`, which is an EdgeOne Edge Function endpoint.
4. The Edge Function creates a six-character code, minimal metadata, short-lived Blob upload URL data, and transfer indexes.
5. Content transfers and file transfers both use the same chunk manifest protocol. Text content is a single encrypted chunk; images pasted into the content box are sent as `file` transfers capped to one 4MB chunk; regular files use 4MB plaintext chunks up to the public relay file limit. Every chunk has its own AES-GCM IV and its own Pages Blob object under `transfer/items/<id>/chunks/`.
6. The browser uploads encrypted bytes directly to EdgeOne Pages Blob and calls `/api/transfer/complete` on the same Edge Function base to mark it readable. `complete` trusts the uploaded chunk manifest and must not `HEAD`/metadata-check every chunk because Pages Blob/COS HEAD calls can time out on larger multi-chunk transfers; missing chunks are surfaced during recipient-side chunk download.
7. A recipient opens `/t/<code>`, enters the password, and the browser sends only a derived proof to the Edge Function.
8. `/api/transfer/open` validates the proof and returns a one-time chunk download manifest with direct Pages Blob GET URLs. It does not read file bytes or text bytes through the Edge Function response. Old non-chunked records are intentionally unsupported and left for scheduled prefix cleanup.
9. `edgeone.json` schedules `/api/transfer/cleanup` daily at 02:00 Asia/Shanghai and deletes every object under the `transfer/` prefix in the Blob store. Scheduled cleanup can run without a request body during the Beijing 02:00 hour; manual cleanup outside that window requires the admin password protected by `TRANSFER_ADMIN_PASSWORD_HASH`.
10. `/t/status` is the browser admin view for public relay storage usage. It asks for the admin password and calls `/api/transfer/stats` to show total bytes, object counts, type breakdowns, largest objects, and metadata read failures. It can also call `/api/transfer/cleanup` with the same password for immediate manual cleanup.
11. `/api/transfer/stats` is a read-only admin endpoint protected by `TRANSFER_ADMIN_PASSWORD_HASH`; it lists Blob objects, reads object metadata, and returns storage totals plus the largest objects. Per-object metadata failures are reported in the response instead of failing the whole stats request.
12. Created transfers show a QR code whose URL hash can carry the read password as `/t/<code>#p=<password>`; the read page consumes the hash client-side and removes it from the address bar before any API call.

LAN transfer flow:

1. `/t` has a separate `局域网互传` tab independent from the encrypted public relay UI.
2. LAN transfer is intentionally versioned as a breaking protocol. Major LAN protocol updates do not keep compatibility branches for older LAN sessions; stale sessions must refresh and pair again.
3. LAN Session V5 is a full-viewport chat-style workbench instead of a panel inside the toolbox shell. Entering LAN mode renders an independent QQ-like app surface that covers the original toolbox layout and route chrome. Desktop renders a two-column layout: a device/session sidebar with the live connection list on the left, and the selected connection's full chat window on the right. Mobile renders two layers: a device page first, then a pure chat page with only the fixed chat header, independently scrolling message stream, and fixed composer. The message stream follows QQ-style grouping with centered time pills, incoming sender labels above the bubble, constrained text/image/file bubble widths, and no separate per-message timestamp row. There is no standalone file panel or mobile file tab; files stay as chat attachments.
4. Any device can create a pairing QR code as WebRTC `host`; any number of other devices can scan `/t#mode=lan&room=<roomId>&token=<roomToken>` and join that room as separate `guest` peers. The host keeps the same QR/link available so more devices can join later. The browser removes the raw token from the address bar after reading it and stores only the current V5 invite in sessionStorage.
5. The QR token stays browser-side. The browser hashes it locally and sends only `tokenHash` in Supabase Realtime payloads.
6. Both browsers subscribe to the public Realtime channel `lan-transfer:<roomId>`, track peer presence, and use Broadcast only for the `lan` signaling event. Presence payloads carry `peerId`, `role`, `peer`, `tokenHash`, and `joinedAt`; Broadcast payloads carry `roomId`, `tokenHash`, `from`, `to`, `seq`, and `ts`. The local device display name is a stable English friendly name stored in localStorage, such as `Sunny Phone A7K2`, instead of browser platform strings such as `Linux armv81`.
7. Supported signaling messages are `announce`, `signal`, and `peer-left`. Signaling is routed by `from`/`to`: the host creates one `simple-peer` instance per guest, guests connect only to the host and ignore other guests, and each peer can reconnect inside the same page session. `announce` is retried until connection and can be restarted after disconnect. No database tables, Supabase Storage objects, service role key, or secret key are used.
8. The browser uses `simple-peer` with STUN-assisted WebRTC config (`stun:stun.l.google.com:19302`) to exchange offer/answer/ICE through Supabase Broadcast, then opens a WebRTC DataChannel named `lan-session-v5`. STUN is used only for candidate discovery; there is intentionally no TURN server or WebSocket file relay fallback for this hotspot transfer mode.
9. Once connected, each host/guest pair is an equal WebRTC data connection. Either side can send text messages, recorded voice messages, images, or files to the currently selected peer. The high-cohesion transfer core is `src/lib/lan-transfer/connection-runtime.ts`: one runtime instance owns one peer connection's protocol dispatch, file list, queues, chunk validation, progress, cancellation, and same-page resume state. `src/app/toolbox/use-lan-transfer-engine.ts` is the multi-connection adapter that owns the connection table, selected peer, per-peer chat state, and one runtime per peer. React UI, SimplePeer, Supabase signaling, QR code, and voice recording are adapters around that runtime.
10. Chat message list order is the local session insertion order so peer clock skew cannot reorder visible history; sender-created `createdAt` is retained for time display only. Attachment offers reuse the original attachment message time for display. Images and voice messages render as media bubbles once cached, while ordinary files render as file cards that wait for the receiver's download action.
11. V5 control messages include `capability`, `chat-message`, `attachment-offer`, `attachment-accept`, `attachment-progress`, `attachment-complete`, `attachment-received`, `attachment-cancel`, `resume-query`, and `resume-state`. Control messages carry `protocolVersion`, `peerId`, `seq`, and `createdAt` where applicable. Attachments use `attachmentId + chunkIndex` for ordered validation and idempotent writes. Each binary chunk carries a CRC32 checksum in the chunk header so corrupted chunks are rejected before storage writes.
12. Multiple selected files are sent as independent attachments in one message, not as a ZIP. Each attachment has its own progress, completion, failure, and file-record state.
13. Voice uses browser `MediaRecorder` to create a voice-message attachment. It is not a realtime voice call feature. Voice attachments are automatically cached as browser object URLs and rendered as playable chat bubbles.
14. Incoming image and voice attachment offers are accepted automatically and cached for in-chat display without opening the browser download flow. Automatic media caching never uses File System Access because it requires a user gesture; it uses memory for small media and OPFS/IndexedDB when needed. Ordinary file attachments still wait for the user to click the file card's download action. After that, desktop browsers with File System Access use direct file save first, then progressively fall back to OPFS, IndexedDB, or memory when needed. Non-direct file storage creates an object URL for download and keeps the completed cache until the user leaves or clears it from file management.
15. Same-page reconnect is supported: outgoing attachment queues and incoming received ranges are retained in memory, and after WebRTC reconnect the peers exchange `resume-query` / `resume-state` so the sender can skip chunks already acknowledged by the receiver. Progress acknowledgements are throttled by byte/time windows to avoid control-message flooding during large transfers. If the receiver completed a file but the final confirmation was lost, reconnecting re-sends the completion acknowledgement instead of asking the user to download the same file again. Refresh-level or cross-device persistent resume is not promised.
16. LAN large-file support is beta-scoped: 10GB+ is only advertised for peers that pass the real OPFS write probe. IndexedDB fallback is capped to a 1GB recommendation and 2GB experimental maximum because final export still creates a Blob URL from stored chunks.

Important constraints:

- `NEXT_PUBLIC_TRANSFER_API_BASE` is required for the encrypted public relay UI. There is intentionally no Next/Netlify API fallback; if Edge Functions are unavailable, transfer create/open fail.
- Passwords are never sent to the server, but the server does receive a password-derived proof for access control. QR-code password sharing uses URL hash fragments so the password stays browser-side.
- Transfer metadata keeps only the salt, per-chunk IV manifest, proof hash, public details, status, and expiry; KDF settings are fixed in client code.
- Public relay transfer size limits are 4MB for content text or pasted images and 200MB for regular files. Text uses one encrypted chunk; pasted images use the file protocol but are capped to one chunk; public relay files use 4MB plaintext chunks so Edge Functions do not read or return Blob object bodies. Old non-chunked payloads are intentionally unsupported.
- EdgeOne Blob is accessed inside Edge Functions with platform auth. No `EDGEONE_PAGES_PROJECT_ID` or `EDGEONE_API_TOKEN` is needed for this transfer path.
- EdgeOne Function environment variables: `TRANSFER_RATE_SALT` is required, `TRANSFER_ADMIN_PASSWORD_HASH` is required for `/api/transfer/stats` and manual `/api/transfer/cleanup`, `EDGEONE_BLOB_STORE` defaults to `message-transfer`, and `TRANSFER_ALLOWED_ORIGIN` is optional CORS tightening.
- LAN transfer environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are required in the browser bundle. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted only as a compatibility fallback.
- Blob has no native TTL in this project; expiry is enforced by read-time lazy deletion plus a scheduled cleanup that clears the whole `transfer/` prefix each Beijing 02:00.

## Face Privacy Masking Toolbox

Frontend:

- `src/app/toolbox/face-mask-tool.tsx`
- `src/app/toolbox/face-mask-editor.tsx`
- `src/app/toolbox/face-mask-controls.tsx`
- `src/lib/face-mask/`

Flow:

1. `/toolbox/face-mask` loads a browser-only editor wrapped in `ToolPageShell`.
2. Before upload, the page shows one large drop zone. After upload, that same space is replaced by the canvas editor; changing the image is a small toolbar action.
3. Images stay in browser memory as `File`, ObjectURL, `ImageBitmap`, and canvas data. No API route receives files or detection results.
4. Automatic face detection is loaded only after the user clicks auto detect. The browser dynamically imports MediaPipe Tasks Vision from jsDelivr and uses Google's BlazeFace full-range model URL.
5. Mask rectangles are stored in original image coordinates. Preview rendering scales them for display, while export renders to an original-size canvas and encodes by source-friendly format: JPEG/WEBP use quality-controlled output, PNG is kept only when it is not substantially larger than the source, otherwise WEBP is tried as a smaller fallback.
6. Manual masks are added by entering add mode and tapping/clicking the image. Drag gestures are reserved for moving existing boxes, and the white corner handle resizes them.
7. Dragging and resizing mask boxes uses `interactjs` for pointer/touch handling. Mask rendering and export use the native Canvas API.
8. Emoji sticker UI, preview, and export use the browser/system emoji font so the exported image matches the in-browser preview.

## Build And Generated Files

Scripts in `package.json`:

- `dev`: Next dev on port `2025` with Turbopack.
- `predev`: runs `pnpm generate:word-cloud`.
- `generate:word-cloud`: runs `scripts/generate-word-cloud.cjs`.
- `prebuild`: runs `pnpm generate:word-cloud`.
- `build`: Next build with Turbopack.
- `svg`: regenerates `src/svgs/index.ts`.
- `format`: Prettier.

Per project instructions, do not run `pnpm`, `npm`, or package scripts for verification unless the user explicitly asks.

`scripts/generate-word-cloud.cjs` reads blog Markdown and `public/blogs/index.json`, then writes `public/blogs/word-cloud.json`. This is a required generated content artifact for the word-cloud UI.

## Deployment

Deployment config:

- `netlify.toml`

Netlify settings:

- build command: `pnpm run build`
- publish directory: `.next`
- Node version: 22
- plugin: `@netlify/plugin-nextjs`

EdgeOne settings:

- `edge-functions/api/transfer/[[default]].js` exposes `/api/transfer/*` for transfer create, complete, meta, open, stats, and cleanup.
- `edgeone.json` schedules transfer cleanup at 02:00 Asia/Shanghai.
- The frontend must set `NEXT_PUBLIC_TRANSFER_API_BASE` to the EdgeOne Functions origin, for example `https://transfer.example.com`.

Cache headers are configured for:

- `/images/*`
- `/audio/*`
- `/blogs/*`

## Architectural Risks And Constraints

Important risks:

- TypeScript build errors are ignored in `next.config.ts`.
- Blog detail rendering is client-side, which weakens SEO and no-JS readability.
- Content consistency depends on keeping JSON indexes, Markdown, generated word-cloud data, and image repository assets aligned.
- Some route directories exist without route implementations, such as sitemap and robots.

Important constraints:

- Follow `AGENTS.md` before making changes.
- Do not run package scripts unless explicitly requested.
- Exclude `node_modules` when searching.
- Keep image assets in the sibling image repository according to project instructions.
- Prefer existing local patterns over new abstractions.

## Quick Orientation For Future Agents

If you need to work on blogs:

1. Read `public/blogs/index.json`.
2. Read the target `public/blogs/<slug>/config.json`.
3. Read the target `public/blogs/<slug>/index.md`.
4. If images are involved, inspect the sibling image repo path policy in `AGENTS.md`.
5. Remember `word-cloud.json` is generated by script, not manually authored unless the user asks.

If you need to work on the homepage:

1. Read `src/app/(home)/page.tsx`.
2. Read `src/config/site-content.json`.
3. Read `src/config/card-styles.json`.
4. Read `src/app/(home)/stores/config-store.ts`.

If you need to work on Markdown rendering:

1. Read `src/hooks/use-markdown-render.tsx`.
2. Read `src/lib/markdown-renderer.ts`.
3. Read `src/components/blog-preview.tsx`.
4. Read `src/components/code-block.tsx` and `src/components/markdown-image.tsx` if needed.

If you need to update site content:

1. Edit the relevant JSON, Markdown, or config file directly.
2. Keep image assets aligned with the sibling image repository policy in `AGENTS.md`.
3. Update generated files only when the task explicitly requires the generated artifact.
4. Submit the result through normal code review and commit flow.

If you need to work on news:

1. Read `src/lib/news.ts`.
2. Read `src/app/api/news/[date]/route.ts`.
3. Read `src/app/api/newsnow/focus/route.ts`.
4. Then inspect the relevant news page components.

If you need to work on likes:

1. Read `src/components/like-button.tsx`.
2. Read `supabase/functions/like/index.ts`.
3. Read `supabase/migrations/20260418_create_likes.sql`.
