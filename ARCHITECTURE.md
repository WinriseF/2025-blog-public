# Project Architecture

Last updated: 2026-06-27.

This document is written for future AI agents and maintainers. Read it before doing broad scans of the project.

## What This Project Is

`2025-blog-public` is a personal content site built with Next.js App Router. The core model is:

- Static, versioned content files in this repository.
- A rich client-side frontend for reading, browsing, and visual presentation.
- Hidden browser-side authoring tools that write content back to GitHub through the Git Data API.
- A small amount of server-side routing for RSS and news proxy/parsing.
- A separate Supabase Edge Function for likes.
- An encrypted message/file transfer tool backed by EdgeOne Edge Functions and Pages Blob, plus LAN transfer signaling backed by Supabase Realtime Broadcast.

This is not a traditional CMS-backed blog. Most content is JSON, Markdown, and image references committed to the repo.

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
- `qrcode` for browser-side QR code generation in the transfer toolbox.
- `simple-peer` and `fflate` for browser-side LAN transfer WebRTC sessions and ZIP packaging.
- Netlify deployment through `@netlify/plugin-nextjs`.
- Supabase Edge Function for the like endpoint and Supabase Realtime Broadcast for LAN transfer signaling.
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
- `src/config/`: site config JSON and feature flags.
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
- `/write`: blog creation UI.
- `/write/[slug]`: blog edit UI.
- `/projects`: projects grid from `src/app/projects/`.
- `/pictures`: image gallery from `src/app/pictures/`.
- `/share`: shared links/resources from `src/app/share/`.
- `/bloggers`: blogroll from `src/app/bloggers/`.
- `/about`: about page from `src/app/about/`.
- `/news` and `/news/[date]`: news index/detail.
- `/calendar`, `/world-clock`, `/music`, `/t`, `/t/[code]`, `/image-toolbox`, `/game`, `/svgs`: utility or experimental pages. `/toolbox` and `/toolbox/transfer/[code]` redirect to the shorter toolbox routes.
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
- `src/config/public-admin-actions.ts`

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
- `src/app/(home)/stores/layout-edit-store.ts`
- `src/app/(home)/home-draggable-layer.tsx`
- `src/app/(home)/config-dialog/`
- `src/config/site-content.json`
- `src/config/card-styles.json`

The homepage is a card-based dashboard/personal page. Cards read dimensions, order, enabled state, and offsets from `card-styles.json`. The config store loads site content and card styles into Zustand.

Hidden edit/config behavior exists behind `SHOW_PUBLIC_ADMIN_ACTIONS` in `src/config/public-admin-actions.ts`. The flag is currently `false`, so public visitors do not see admin controls, but the related client code still exists in the project.

## Navigation

Global navigation is `src/components/nav-card.tsx`.

It is rendered by the global layout on all pages. It adapts between:

- full card mode on the homepage,
- mini mode on `/write`,
- icon strip mode on other routes and mobile.

Navigation items are currently hardcoded inside `nav-card.tsx`.

## Authoring And GitHub Write-Back

The project contains hidden authoring/editing flows for:

- blogs
- projects
- pictures
- shares
- bloggers/about/site config in related modules

Core GitHub modules:

- `src/lib/auth.ts`
- `src/hooks/use-auth.ts`
- `src/lib/github-client.ts`
- `src/consts.ts`

Blog write service:

- `src/app/write/services/push-blog.ts`

Other write services follow the same pattern:

- `src/app/projects/services/push-projects.ts`
- `src/app/pictures/services/push-pictures.ts`
- `src/app/share/services/push-shares.ts`
- `src/app/blog/services/batch-delete-blogs.ts`
- similar route-local `services/` folders

Write-back model:

1. User imports a GitHub App private key file in the browser.
2. `src/lib/auth.ts` signs a JWT with `jsrsasign`.
3. The app gets a GitHub installation id and installation token.
4. Service code creates blobs, a tree, a commit, then updates the branch ref through GitHub Git Data API.
5. The target repo/branch comes from `GITHUB_CONFIG` in `src/consts.ts`.

This is efficient for a personal site, but the private key is used in browser memory. UI hiding is not a security boundary.

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

This is better isolated than the GitHub write-back flow because privileged credentials live server-side.

## Message Transfer Toolbox

Frontend:

- `src/app/toolbox/toolbox-client.tsx`
- `src/app/toolbox/transfer-tool.tsx`
- `src/app/toolbox/lan-transfer-tool.tsx`
- `src/lib/lan-transfer/`
- `src/app/toolbox/transfer/[code]/page.tsx`
- `src/lib/transfer-crypto.ts`

Backend:

- `edge-functions/api/transfer/[[default]].js`
- `edgeone.json`

Encrypted relay flow:

1. User creates a text or file transfer from the toolbox.
2. The browser derives an AES-GCM key from the password with fixed PBKDF2-SHA256 settings and encrypts the payload locally.
3. The browser calls `${NEXT_PUBLIC_TRANSFER_API_BASE}/api/transfer/create`, which is an EdgeOne Edge Function endpoint.
4. The Edge Function creates a six-character code, minimal metadata, a short-lived Blob upload URL, and transfer indexes.
5. The browser uploads encrypted bytes directly to EdgeOne Pages Blob and calls `/api/transfer/complete` on the same Edge Function base to mark it readable.
6. A recipient opens `/t/<code>`, enters the password, and the browser sends only a derived proof to the Edge Function.
7. `/api/transfer/open` validates the proof, returns encrypted bytes once, and deletes the active payload, metadata, and code.
8. `edgeone.json` schedules `/api/transfer/cleanup` daily at 02:00 Asia/Shanghai and deletes every object under the `transfer/` prefix in the Blob store. The cleanup endpoint only accepts calls during the Beijing 02:00 hour to reduce public abuse.
9. `/api/transfer/stats` is a read-only admin endpoint protected by `TRANSFER_ADMIN_PASSWORD_HASH`; it lists Blob objects, reads object metadata, and returns storage totals plus the largest objects. Per-object metadata failures are reported in the response instead of failing the whole stats request.
10. Created transfers show a QR code whose URL hash can carry the read password as `/t/<code>#p=<password>`; the read page consumes the hash client-side and removes it from the address bar before any API call.

LAN transfer flow:

1. The transfer toolbox has a separate `局域网互传` tab independent from `创建中转` and `读取中转`.
2. Any device can create a pairing QR code as WebRTC `host`; another device scans `/t#mode=lan&room=<roomId>&token=<roomToken>` and joins as `guest`.
3. The QR token stays in the URL hash. The browser hashes it locally and sends only `tokenHash` in Supabase Realtime payloads.
4. Both browsers subscribe to the public Realtime channel `lan-transfer:<roomId>` and broadcast the `lan` event. Every payload carries `roomId`, `tokenHash`, `peerId`, and `ts`; received messages are ignored unless `roomId` and `tokenHash` match the local session.
5. Supported signaling messages are `hello`, `signal`, and `peer-left`. No database tables, Supabase Storage objects, service role key, or secret key are used.
6. The browser uses `simple-peer` to exchange offer/answer/ICE through Supabase Broadcast, then opens a WebRTC DataChannel named `file`.
7. Once connected, both devices are equal peers: either side can request to send files, and the other side must accept before receiving.
8. Single files are sent directly in 64KB DataChannel chunks. Multiple files are packaged into a ZIP with `fflate` and sent as one payload.

Important constraints:

- `NEXT_PUBLIC_TRANSFER_API_BASE` is required for the encrypted public relay UI. There is intentionally no Next/Netlify API fallback; if Edge Functions are unavailable, transfer create/open fail.
- Passwords are never sent to the server, but the server does receive a password-derived proof for access control. QR-code password sharing uses URL hash fragments so the password stays browser-side.
- Transfer metadata keeps only the salt, IV, proof hash, public file details, status, and expiry; KDF settings are fixed in client code.
- Transfer size limits are 1MB for text and 20MB for files, staying below the EdgeOne Blob single-object limit.
- EdgeOne Blob is accessed inside Edge Functions with platform auth. No `EDGEONE_PAGES_PROJECT_ID` or `EDGEONE_API_TOKEN` is needed for this transfer path.
- EdgeOne Function environment variables: `TRANSFER_RATE_SALT` is required, `TRANSFER_ADMIN_PASSWORD_HASH` is required only for `/api/transfer/stats`, `EDGEONE_BLOB_STORE` defaults to `message-transfer`, and `TRANSFER_ALLOWED_ORIGIN` is optional CORS tightening.
- LAN transfer environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are required in the browser bundle. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted only as a compatibility fallback.
- Blob has no native TTL in this project; expiry is enforced by read-time lazy deletion plus a scheduled cleanup that clears the whole `transfer/` prefix each Beijing 02:00.

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

- GitHub App private key is used in browser memory for authoring write-back.
- `SHOW_PUBLIC_ADMIN_ACTIONS=false` hides UI only; it is not real authorization.
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

If you need to work on content publishing:

1. Read `src/lib/auth.ts`.
2. Read `src/lib/github-client.ts`.
3. Read the route-local `services/push-*.ts` file.
4. Treat the browser-side private-key model as a known risk.

If you need to work on news:

1. Read `src/lib/news.ts`.
2. Read `src/app/api/news/[date]/route.ts`.
3. Read `src/app/api/newsnow/focus/route.ts`.
4. Then inspect the relevant news page components.

If you need to work on likes:

1. Read `src/components/like-button.tsx`.
2. Read `supabase/functions/like/index.ts`.
3. Read `supabase/migrations/20260418_create_likes.sql`.
