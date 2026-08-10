# Project Architecture

Last updated: 2026-08-10.

This document is written for future AI agents and maintainers. Read it before doing broad scans of the project.

## What This Project Is

`2025-blog-public` is a personal content site built with Next.js App Router. The core model is:

- Static, versioned content files in this repository.
- A rich client-side frontend for reading, browsing, and visual presentation.
- Content maintained by editing repository files and submitting normal code commits.
- A small amount of server-side routing for news proxy/parsing.
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
- `@pierre/diffs@1.2.12` for Git/SVN diff review and Codex Session patch parsing/rendering.
- `stream-chain`, Zod, Acorn/Acorn Walk, `web-tree-sitter`, PowerShell/Bash/CMD WASM grammars, `pathe`, TanStack Virtual, Recharts, and `strip-ansi` for the browser-only Codex Session parser.
- `motion` for animation.
- `lucide-react` and local SVG files for icons.
- `interactjs` for pointer-based drag/resize interactions in the face privacy masking tool.
- `qrcode` for browser-side QR code generation in the transfer toolbox.
- Native browser `RTCPeerConnection` and `RTCDataChannel` APIs for LAN transfer sessions.
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

## Frontend Animation And Main-Thread Performance

Continuous visual loops use `src/lib/animation-loop.ts`. The scheduler keeps the browser's visible `requestAnimationFrame` cadence, pauses work while the document or target is not visible, and resets frame timing on resume so a background-tab gap cannot create a large simulation jump. The global atmosphere, homepage WebGL core, world clock, and game use this lifecycle. The atmosphere keeps its CSS surface but releases animated Canvas layers while the opaque `/game` or `/world-clock` surface covers them; ambient rain selection and music behavior remain mounted.

Performance-sensitive interaction rules:

- The `/home` card sphere has no idle frame loop. React updates run only while dragging or inertial motion is active, and per-tile `will-change` promotion exists only during that motion.
- World-clock rendering remains display-synchronized, while stable marker geometry, label vectors, Canvas dimensions, and DOM style values are reused. Astronomical lighting refreshes once per displayed clock second, hidden-tab timers stop, and WebGL resources/context are explicitly released on teardown.
- Game rendering keeps its visible frame cadence and DPR, but hidden/offscreen frames stop, resize events are coalesced, and duplicate backing-store allocations are ignored. Ball trails use a fixed five-point ring and transient entity lists compact in place to avoid frame-by-frame garbage collection spikes; HUD markup lives in `src/app/game/game-surface.tsx`.
- Pointer-heavy surfaces cache layout bounds at gesture start and coalesce updates to one per display frame; do not reintroduce layout reads inside raw pointer-move loops.
- Blog TOC headings share one `IntersectionObserver`. Mermaid diagrams consume the existing time-theme context instead of installing one document observer per diagram.
- Word-cloud placement uses short `d3-cloud` time slices so large year sets do not monopolize the main thread. Markdown code-block replacement uses indexed element placeholders rather than scanning every parsed text node against every code block.
- The `/calendar` route renders a fixed 42-day month grid and memoizes month, almanac, festival, solar-term, and annual-progress data around the active date. Month, date, and path transitions are finite transform/opacity animations; its only continuous loop is a CSS orbit rotation that is disabled by reduced-motion preferences.

These optimizations intentionally do not lower visible animation frame rate, Canvas/WebGL pixel ratio, or visual density. Future performance work should preserve that invariant and target invisible, idle, duplicated, or allocation-heavy work first.

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
- `/calendar`: responsive Gregorian/lunar calendar with a fixed six-week grid, keyboard month/day navigation, selected-day almanac, solar-term trajectory, and explicit dawn/noon/sunset/night visual variants. `calendar-client.tsx` owns interaction state, `calendar-data.ts` derives date models, and the grid, day panel, and term track are split into focused components.
- `/world-clock`, `/music`, `/game`, `/svgs`: utility or experimental pages.
- `/toolbox`: toolbox directory page with links to the browser tools, `/toolbox/agent`, `/toolbox/version-control`, and `/t`.
- `/toolbox/agent`: WinriseF Toolbox Agent capability center and portable protocol-registration result page.
- `/toolbox/compress`: image compression tool.
- `/toolbox/markdown`: local Markdown preview tool with a desktop expanded preview mode and independent preview reading progress.
- `/toolbox/face-mask`: local privacy masking tool for face detection, manual rectangular masks, and original-size image export.
- `/toolbox/password`: browser-only random password, passphrase, and PIN generator.
- `/toolbox/codex-session`: browser-only Codex rollout JSONL audit dashboard for key command runs, explicit file reads, successful file patches, and recorded Token usage.
- `/t`, `/t/[code]`, and `/t/status`: public encrypted transfer, LAN transfer, and relay storage status entrypoints.
- `/healthz`: lightweight uncached `GET`/`HEAD` health probe implemented in `src/app/healthz/route.ts` for the `e`, `n`, and `v` deployments.

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

- `public/blogs/index.json`: list of blog metadata used by the blog index.
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

## Sitemap, Robots

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

Toolbox UI uses short `motion/react` entry, upload-state, and button-press feedback with reduced-motion opt-outs. Markdown preview can hide the editor and fill the toolbox card on desktop; its embedded progress bar tracks and scrubs only the preview scroll area. Entering the LAN workbench runs a one-shot, pointer-free Canvas water ripple from the tab click position: a downsampled, damped height-field simulation draws cyan crests over the workbench for about 1.3 seconds, then unmounts. Reduced-motion preferences skip it. Transfer progress and connection state keep their existing lightweight CSS transitions to avoid animation work on high-frequency events.

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

Native File V1 grants carry only the transfer/attachment identity, Agent owner, and authorization data needed by the peer page. Direction, size, data-plane, segment, and concurrency settings remain bound by the Agent or fixed by V1 instead of being echoed in every grant.

LAN/Agent V13 benchmark and IPv6 baseline (supersedes the V12, Bridge V2, and older LNA-selection details below): WebRTC ICE uses Google STUN for Candidate discovery, with no TURN or relay Candidates. Agent Bridge V3 signs fresh endpoint snapshots, emits network-address and firewall-policy changes, and publishes private IPv4/CGNAT/ULA immediately while withholding GUA IPv6 until Windows Firewall authorization reaches `available`. Protocol launch binds UDP/TCP and opens the HTTPS callback before asynchronously requesting UAC, so private/LNA paths and the loopback Bridge never wait for elevation. The peer races published GUA IPv6 immediately and private candidates after 200ms, gives each candidate four seconds, reuses one winner for all six connections in the current network epoch, and invalidates the winner on address changes or group failure. LNA permission applies only to private HTTP/ULA and never blocks an authorized public IPv6 WebTransport endpoint. A browser-sourced native transfer that fails before its first byte cancels the Agent grant and re-offers the same message/attachment ID over the V13 WebRTC scheduler through the `native-transfer-fallback` control message. Route UI exposes only `IPv6 公网直连`, `IPv6 内网直连`, `IPv4 热点/局域网直连`, or NAT/direct classifications and never renders complete addresses.

1. `/t` has a separate `局域网互传` tab independent from the encrypted public relay UI.
2. LAN transfer is intentionally versioned as a breaking protocol. Major LAN protocol updates do not keep compatibility branches for older LAN sessions; stale sessions must refresh and pair again.
3. LAN Session V13 is a full-viewport chat-style workbench instead of a panel inside the toolbox shell. Entering LAN mode renders an independent QQ-like app surface that covers the original toolbox layout and route chrome. Desktop renders a two-column layout: a device/session sidebar with the live connection list on the left, and the selected connection's chat or independent connection-speed page on the right. Mobile renders separate device, chat, and connection-speed pages without unmounting the live LAN controller. The message stream follows QQ-style grouping with centered time pills, incoming sender labels above the bubble, constrained text/image/file bubble widths, and no separate per-message timestamp row. There is no standalone file panel or mobile file tab; files stay as chat attachments. While the LAN workbench is mounted, `src/hooks/use-lan-screen-wake-lock.ts` requests a Screen Wake Lock by default and releases it on exit. The device view exposes a persisted opt-out switch; browser or OS release while hidden is followed by a fresh request when the page becomes visible again, while unsupported or rejected Wake Lock never blocks transfer. The expanded `极速模式` panel always exposes the connection-speed page even when Agent acceleration is disabled; merely opening that page never launches the Agent, requests LNA permission, or starts traffic. The speed page can select one or every connected device, upload/download/both, 64MiB/256MiB/1GiB payloads, automatic routing, WebRTC, HTTP/TCP, QUIC, or all available concrete planes. Suites run strictly sequentially so tests do not compete for the same radio. Manual TCP or QUIC tests fail explicitly and never switch planes; only `自动选路` may fall back to WebRTC. Synthetic zero bytes are streamed without reading or writing a user file; every test reserves its peer connection, refuses to start over an active file task, rejects new file tasks until release, and leaving/cancelling the page aborts active HTTP requests, QUIC connections, or DataChannel sending. The Windows Agent is distributed as one portable EXE with no installer, service, tray, startup entry, or self-copy. A no-argument double-click registers the EXE's current path as the current user's `winrisef://` handler, opens `/toolbox/agent?agent-ready=1` (or `0` on failure), and exits; `src/app/toolbox/agent/agent-page-client.tsx` shows the result and removes that one-shot query parameter. Moving or renaming the EXE requires another double-click to repair the registered path. WebTransport-capable desktop browsers can then launch the headless Agent through `winrisef://`; a per-user mutex prevents concurrent protocol-launch processes from racing the fixed port. The page treats launch as single-flight, keeps unexpired nonces so a legitimate delayed callback remains acceptable, and disables repeat toggles while launching or connecting. The Agent accepts only its built-in production Origin, loopback development Origins, or exact HTTPS Origins explicitly embedded during protocol registration. `src/app/t/native-agent-return/` consumes the HTTPS fragment callback and hands it to the original tab through exactly one transport: BroadcastChannel when available, otherwise a localStorage event fallback. The original tab deduplicates callbacks before `src/lib/lan-transfer/native-agent/local-bridge.ts` consumes the one-time launch token over a pinned loopback WebTransport Bridge V3 using bounded length-prefixed JSON control frames. Bridge snapshots expose `publicIpv6State`; firewall authorization can update endpoints without replacing the Bridge. Phone/tablet views never launch or install an Agent. Once connected, the installed browser publishes the Agent's currently authorized LAN HTTP endpoint, WebTransport endpoint, and certificate hash through `LanCapability`; benchmark bytes never pass through that installed browser. On the remote pure webpage, a user-triggered automatic or explicit TCP benchmark queries the Chrome 142 `local-network-access` permission descriptor. `denied` retains ordinary WebRTC unless an authorized public IPv6 endpoint is available; an unsupported descriptor permits an automatic WebTransport attempt; `prompt` or `granted` probes the Agent HTTP endpoint and uses LNA only after the request succeeds. Supported LNA with an unreachable endpoint, bad CORS, or an outdated Agent is an explicit TCP error and must not masquerade as unsupported. `peer-lna-http.ts` uses six concurrent XHR workers and bounded requests of at most about 30MiB, with a distinct short-lived one-time ticket per request, while the Agent streams bytes over cleartext HTTP/1.1/TCP without allocating the logical benchmark total. The compatibility `peer-webtransport.ts` requests six tickets in both directions and distributes the logical byte total across six independent WebTransport/QUIC connections; every connection retains deterministic 16MiB stripes and four lanes. Agent logs record the chosen data plane and one low-frequency completion summary per request/connection. Formal Native File V1 is separate from those benchmark adapters: ordinary files at least 64MiB use six 30MiB LNA segments when Chrome grants LNA, or six WebTransport connections with four lanes and 64MiB extents when an authorized endpoint is selected. The installed page talks to `LanNativeLocalAgentPort` for system file selection, save preparation, grants, cancellation, and events; the pure page uses `LanNativePeerBulkPort` for bytes. Each endpoint renders only its local native data-plane progress (browser XHR or Agent events); progress is not mirrored through DataChannel, and only the final `attachment-received` confirmation crosses back to the sender. Images, voice, pasted/dropped content, and smaller files remain on WebRTC. If both desktop pages publish an Agent, stable device-ID ordering keeps only one active advertisement.
4. Any device can create a pairing QR code as WebRTC `host`; any number of other devices can scan `/t#mode=lan&room=<roomId>&token=<roomToken>` and join that room as separate `guest` peers. The host keeps the same QR/link available so more devices can join later. WeChat and QQ embedded browsers first show a dialog that offers either copying the invite into a normal browser or continuing the LAN session in the embedded browser despite possible file limitations. Continuing stores the invite and removes its raw token from the address bar just like the normal-browser path. Normal browsers enter the LAN session immediately and store only the current V13 invite in sessionStorage.
5. The QR token stays browser-side. The browser hashes it locally and sends only `tokenHash` in Supabase Realtime payloads.
6. Both browsers subscribe to the public Realtime channel `lan-transfer:<roomId>`, track peer presence, and use Broadcast only for the `lan` signaling event. A stable localStorage `deviceId` keys the long-lived conversation/runtime, while a volatile `instanceId` identifies the current page instance. V13 signaling also carries `generation`, `negotiationId`, `messageId`, `seq`, and an optional hard-recovery request, so stale connection generations and stale negotiation candidates are discarded and soft ICE recovery is not confused with a required Transport rebuild. The stable English friendly name and random DiceBear `avatarSeed` remain device-local metadata.
7. Supported V13 signaling messages are `announce`, `reconnect-request`, `rebuild`, `ice-restart`, `offer`, `answer`, `candidate`, `signal-ack`, and `peer-left`. The host owns each guest connection generation and is the only side that creates offers; guests request recovery and answer host offers. Rebuild/restart/offer/answer messages use application-level ACK, bounded resend, and message-id deduplication. Candidate delivery is duplicate-tolerant and cached by `generation + negotiationId` until the matching remote description is installed. IPv4 and IPv6 Candidates are passed through unchanged; the application does not filter an address family or rewrite SDP, leaving path selection to browser ICE.
8. `src/lib/lan-transfer/signal-client.ts` tracks Realtime independently as `connecting`, `online`, `retrying`, `offline`, or `closed`. Supabase Realtime runs its own heartbeat in a Web Worker where supported and uses the SDK's channel rejoin/backoff instead of an application timer that removes and recreates Channels. Every resubscribe re-tracks Presence, announces the local instance, and flushes pending critical signals and queued Candidates. Page focus, visibility restore, `online`, `pageshow`, and Network Information changes request an immediate socket wake and connection health pass.
9. `src/lib/lan-transfer/native-webrtc-transport.ts` owns one native `RTCPeerConnection` generation and the single reliable ordered `lan-session-v13` DataChannel. It implements SDP exchange, per-negotiation Candidate buffering, bounded backpressure, transport hello/ready, native `restartIce()`, connection-state events, selected-candidate route/health inspection, and pre-transfer binary frame-size probing. Liveness never uses ping/pong on the ordered file channel: `getHealthStats()` reads ICE state plus the selected Candidate Pair's `bytesSent`, `bytesReceived`, `consentRequestsSent`, and `responsesReceived`, which are not delayed behind queued file frames. Chunk negotiation probes a 128KB frame with a 124KB payload, then falls back to a 64KB frame with a 60KB payload. `inspectRoute()` exposes only structured family/type labels (`IPv6 直连`, `IPv4 局域网直连`, `IPv4 NAT 直连`, `IPv4 直连`, or `未知直连`); complete addresses are never stored in view state or rendered. STUN (`stun:stun.l.google.com:19302`) is used only for candidate discovery; there is intentionally no TURN or WebSocket file relay fallback.
10. Once connected, each host/guest pair is an equal WebRTC data connection. Either side can send text messages, recorded voice messages, images, or files to the currently selected peer. `src/lib/lan-transfer/reconnect-coordinator.ts` owns the per-device connection state machine and replaces only the temporary Transport. `src/lib/lan-transfer/connection-runtime.ts` remains the device session core for protocol dispatch, file queues, received ranges, progress, cancellation, same-page resume, and chat history. `src/app/toolbox/use-lan-transfer-engine.ts` keeps one Runtime per stable device and rejects data or async completion callbacks from an obsolete Transport id/epoch.
11. Chat message list order is the local session insertion order so peer clock skew cannot reorder visible history; sender-created `createdAt` is retained for time display only. Text messages show one check only after they are written to the DataChannel and two checks only after the receiving runtime accepts the message and returns `chat-receipt`; this is a delivery receipt, not a read receipt. Attachment offers reuse the original attachment message time for display. Images and voice messages render as media bubbles once cached, while ordinary files render as file cards that wait for the receiver's download action.
12. V13 DataChannel control messages include `capability`, `native-agent-ticket-request`, `native-agent-ticket-response`, `webrtc-benchmark-request`, `webrtc-benchmark-ready`, `webrtc-benchmark-result`, `webrtc-benchmark-cancel`, `chat-message`, `chat-receipt`, `chat-history`, `attachment-offer`, `native-transfer-request`, `native-transfer-ready`, `attachment-accept`, `attachment-progress`, `attachment-complete`, `attachment-received`, `attachment-cancel`, `resume-query`, and `resume-state`. `src/lib/lan-transfer/webrtc-benchmark-runtime.ts` sends a separate binary frame kind over the real reliable ordered DataChannel, validates benchmark ID, negotiated chunk tier, exact sequence, exact per-frame size, and final byte count, and never creates attachment/chat/storage state. Native Agent advertisements never contain a token. Benchmark tickets and formal native file grants are obtained only over the established encrypted DataChannel; formal transfer tokens never appear in advertisements, URLs, history, logs, or Supabase. `attachment-accept` and the DataChannel scheduler process only `webrtc` attachments, while native request/ready messages coordinate the independent LNA HTTP or WebTransport byte plane. Control messages carry `protocolVersion`, `peerId`, `seq`, and `createdAt` where applicable. Resume messages additionally carry `resumeId`, `transportGeneration`, and the sender runtime's `transportEpoch`; responses that do not match the current connection attempt are ignored. `chat-history` syncs text/system messages and attachment metadata after reconnect, batches receipts for remote outbound text, and treats the remote inbound history as proof that matching local outbound text was delivered. It does not replay file/media bytes or send object URLs. WebRTC attachments use `attachmentId + chunkIndex` for ordered validation and idempotent writes. Binary chunks do not carry an application-layer CRC32; integrity relies on WebRTC DTLS, SCTP, and exact final file-byte and chunk-count checks before completion is acknowledged.
13. Multiple selected files are sent as independent attachments in one message, not as a ZIP. Each attachment has its own progress, completion, failure, and file-record state. One `LanAttachmentSendScheduler` per device connection is the only attachment-frame writer. It interleaves accepted attachments over the same reliable ordered DataChannel with byte-based weighted round robin: ordinary files receive 512KB turns, while images, voice messages, and files up to 8MB receive up to 2MB turns. Connections between two desktop peers admit at most four active attachments; if either endpoint is Android or iOS, the conservative mobile profile admits at most two so both sender read-cache memory and receiver write pressure stay bounded. A newly accepted priority attachment may pause an active bulk attachment and release its 4MB read cache. Per-attachment disk-unconfirmed data is capped at 16MB on desktop or 8MB with the mobile profile, while the aggregate caps are respectively 64MB and 32MB. Once an attachment's final missing chunk and ordered `attachment-complete` message are queued, it immediately releases its active slot and waits independently for `attachment-received`; final save confirmation never owns the scheduler or blocks another eligible attachment.
14. Voice uses browser `MediaRecorder` to create a voice-message attachment. It is not a realtime voice call feature. Voice attachments are automatically cached as browser object URLs and rendered with `@arraypress/waveform-player` as interactive waveform chat bubbles.
15. Incoming image and voice attachment offers are accepted automatically and cached for in-chat display without opening the browser download flow. Chat images open in a full-screen preview with mouse-wheel and touch-pinch zoom. Automatic media caching never uses File System Access because it requires a user gesture; it uses memory for small media and OPFS/IndexedDB when needed. Ordinary file attachments still wait for the user to click the file card's download action. After that, desktop browsers with File System Access use direct file save first, then progressively falls back to OPFS, IndexedDB, or memory when needed. Direct File and OPFS merge consecutive chunks for each attachment into about 4MB before each filesystem write, even when chunks from different attachments are interleaved on the channel; checkpoints, final chunks, and finalization flush any smaller remainder. Each active sender task likewise retains one approximately 4MB source-file read cache and slices negotiated payload chunks from it across multiple scheduler turns. Data frames negotiate between 128KB and 64KB limits; payload chunks are respectively 124KB and 60KB so both tiers reserve 4KB for the frame header. The chosen size is fixed before creating the attachment manifest and remains unchanged during resume. Non-direct file storage creates an object URL for download and keeps the completed cache until the user leaves or clears it from file management.
16. Same-page reconnect is coordinated per device with `connected → suspect → ice-restarting → rebuilding → backoff`. `src/lib/lan-transfer/connection-health-monitor.ts` samples visible active transfers every 1.5 seconds and idle connections every five seconds. A browser-reported failed/closed ICE path is recovered immediately; a transient disconnected state receives three seconds to recover naturally. While data should be flowing, the monitor first requires evidence that WebRTC sent payload/consent traffic or still has buffered data, then requires ten seconds without either selected-pair receive progress or an ICE consent response before treating the path as dead. Page/network wake watches the next native consent cycle instead of declaring failure from application silence alone. Hidden pages do not fail solely because background timers were throttled. The 60-second DataChannel drain timeout remains only a sender backpressure warning and is never liveness evidence. Entering `suspect` pauses the attachment scheduler without detaching its Runtime or discarding read cursors. Natural recovery or ICE Restart on the same `RTCPeerConnection` resumes that same scheduler directly and does not run range synchronization. ICE Restart has a seven-second timeout; only a closed DataChannel, changed remote page instance, or failed restart detaches the old Transport and starts a full rebuild with a ten-second timeout. Repeated signaling failures retry with capped 0/1/2/4/8-second backoff. A hard-rebuilt Transport stays in `resume-syncing`, where the receiver drains its ordered chunk-write queue, flushes each selected storage engine's checkpoint, and returns one authoritative ranges/bytes snapshot per attachment. The scheduler resets every task's missing-chunk cursor and unconfirmed-byte counters from that response before it resumes; a fully written attachment that still lacks final confirmation sends only `attachment-complete` again. If the global resume snapshot is missing for fifteen seconds, the sender discards stale send cursors, exits the pause, and re-offers every unfinished attachment so each receiver can return its own current checkpoint instead of blocking the whole scheduler indefinitely. Refresh-level or cross-device persistent file resume is not promised.
17. Closing the `X` in a chat header closes only the selected device conversation. It sends a targeted `peer-left`, destroys that device's current WebRTC transport, removes the device-keyed conversation locally, and leaves the LAN room/signaling session alive for other devices. The sidebar/device page keeps a separate global `退出` action for leaving the whole LAN session.
18. LAN large-file support is beta-scoped: 10GB+ is only advertised for peers that pass the real OPFS write probe. IndexedDB fallback is capped to a 1GB recommendation and 2GB experimental maximum because final export still creates a Blob URL from stored chunks.
19. While the LAN workbench is mounted, browser-side connection diagnostics are retained as a bounded, versioned localStorage ring buffer and can be downloaded from the `极速模式` panel as a JSON file. The export merges recent entries from same-origin tabs and covers signaling, WebRTC/reconnect state, Native Agent launch/Bridge snapshots, ticket exchange, LNA probes, and WebTransport endpoint selection. The temporary IPv6 investigation profile samples every ICE Candidate Pair throughout the ten-second connection window, including request/response counters, nomination/selection state, transport/SCTP state, complete Candidate addresses and ports, and `local-network-access` permission changes. Credentials, invite/room data, nonces, passwords, and long secret-like values remain removed; the exported file is local-only, contains network addresses, and must not be shared publicly. Logs are never uploaded automatically. Once the IPv6 regression is resolved, remove the high-frequency Pair sampler and restore address-family-only Candidate summaries.

Important constraints:

- `NEXT_PUBLIC_TRANSFER_API_BASE` is required for the encrypted public relay UI. There is intentionally no Next/Netlify API fallback; if Edge Functions are unavailable, transfer create/open fail.
- Passwords are never sent to the server, but the server does receive a password-derived proof for access control. QR-code password sharing uses URL hash fragments so the password stays browser-side.
- Transfer metadata keeps only the salt, per-chunk IV manifest, proof hash, public details, status, and expiry; KDF settings are fixed in client code.
- Public relay transfer size limits are 4MB for content text or pasted images and 200MB for regular files. Text uses one encrypted chunk; pasted images use the file protocol but are capped to one chunk; public relay files use 4MB plaintext chunks so Edge Functions do not read or return Blob object bodies. Old non-chunked payloads are intentionally unsupported.
- EdgeOne Blob is accessed inside Edge Functions with platform auth. No `EDGEONE_PAGES_PROJECT_ID` or `EDGEONE_API_TOKEN` is needed for this transfer path.
- EdgeOne Function environment variables: `TRANSFER_RATE_SALT` is required, `TRANSFER_ADMIN_PASSWORD_HASH` is required for `/api/transfer/stats` and manual `/api/transfer/cleanup`, `EDGEONE_BLOB_STORE` defaults to `message-transfer`, and `TRANSFER_ALLOWED_ORIGIN` is optional CORS tightening.
- LAN transfer environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are required in the browser bundle. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted only as a compatibility fallback. Formal native file routing is enabled whenever the user enables extreme mode and an Agent connection is available; ordinary files at least 64MiB may then use the native data plane without an additional deployment feature flag.
- LAN transfer has no TURN relay. IPv6-only and IPv4-only peers are not guaranteed to connect to each other even when signaling succeeds; at least one mutually reachable ICE address family/path is required.
- Blob has no native TTL in this project; expiry is enforced by read-time lazy deletion plus a scheduled cleanup that clears the whole `transfer/` prefix each Beijing 02:00.

## Password Generator Toolbox

Frontend:

- `src/app/toolbox/password-generator-tool.tsx`
- `src/lib/password-generator.ts`

Flow:

1. `/toolbox/password` loads a browser-only generator wrapped in `ToolPageShell`; passwords and settings stay in React memory and are never sent to an application server or persisted in browser storage.
2. Random-character and PIN modes use `crypto.getRandomValues` with rejection sampling. Random-character generation guarantees every enabled character group appears, applies optional exclusions, and can prevent adjacent repeats.
3. Passphrase mode lazily fetches a pinned wordlist from jsDelivr only after the user enters that mode: BIP39 English has 2048 entries, while the CC BY 4.0 `chinese-diceware` list provides 8192 unique lowercase pinyin-and-Hanzi pairs. Chinese mode uses pinyin as the copyable password and shows the matching Hanzi as a lighter, non-copying memory hint. The optional no-separator setting concatenates the real password while rendering visual-only gaps between word segments. The client verifies the exact SHA-256 digest, format, entry count, non-empty pairs, and uniqueness before use; failed loads expose a retry action and do not affect the offline character or PIN modes.
4. Strength labels are entropy estimates derived from the effective character pool, the active passphrase wordlist size (11 bits per English word or 13 bits per Chinese pinyin word), or the PIN digit space. Clipboard writes happen only after the user presses the copy action.
5. The generator uses `motion/react` for shared selection indicators, button press feedback, switch springs, result changes, strength updates, and advanced-setting disclosure; reduced-motion preferences disable nonessential movement.

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
4. Automatic face detection is loaded only after the user clicks auto detect. The browser dynamically imports MediaPipe Tasks Vision from jsDelivr and uses Google's BlazeFace full-range model URL. Detected masks use the most recently chosen mask mode even when an existing region is selected.
5. Mask rectangles are stored in original image coordinates. Preview rendering scales them for display, while export renders to an original-size canvas and encodes by source-friendly format: JPEG/WEBP use quality-controlled output, PNG is kept only when it is not substantially larger than the source, otherwise WEBP is tried as a smaller fallback.
6. Manual masks are added by entering add mode and tapping/clicking the image. Drag gestures are reserved for moving existing boxes, and the white corner handle resizes them.
7. Dragging and resizing mask boxes uses `interactjs` for pointer/touch handling. Mask rendering and export use the native Canvas API.
8. Emoji sticker UI, preview, and export use the browser/system emoji font so the exported image matches the in-browser preview.
9. Mosaic and blur rendering derives the sampling size from the mask dimensions instead of using only a fixed source-pixel size, so high-resolution phone photos keep a visible privacy effect in responsive previews and original-size exports.

## OCR Toolbox

Frontend:

- `src/app/toolbox/ocr-tool.tsx`
- `src/app/toolbox/ocr-preview.tsx`
- `src/app/toolbox/ocr-result-panel.tsx`
- `src/app/toolbox/use-ocr-worker.ts`
- `src/components/select-menu.tsx`
- `src/lib/ocr/`

Flow:

1. `/toolbox/ocr` loads a single-image OCR workbench wrapped in `ToolPageShell`. PNG, JPG, JPEG, and WEBP images can be selected, dropped, or pasted; the selected image stays in browser memory as a `File` and Object URL and is never sent to an application API.
2. Selecting an image does not load OCR resources. The first explicit recognize action creates `src/lib/ocr/ocr.worker.ts`, transfers the image as an `ArrayBuffer`, initializes one `PaddleOcrService`, and reuses its ONNX sessions for later images on the same page. Initialization is shown with an indeterminate progress bar because the package exposes one `initialize()` promise but no model byte-progress events.
3. OCR defaults to `ppu-paddle-ocr`'s `V6_SMALL_MODEL`; the page-level model menu can instead select V6 Tiny or V6 Medium. Tiny and Small use the library defaults: per-line recognition, the default confidence threshold, and automatic WebGPU/WASM provider selection. The package's Web tests do not cover Medium and its detector does not implement PaddleOCR's minimum-side resize, so Medium uses WASM plus the official 736px minimum-side preprocessing and 4000px cap. The Worker converts its boxes back to original image coordinates before mapping all package results into project-owned types.
4. Canceling an active task terminates the Worker while retaining the selected image. Changing models also releases the current Worker and ONNX sessions, clears stale results, and keeps the image ready for a new run. Initialization errors and Worker crashes discard the instance so retry starts fresh; route unmount always terminates it, and image replacement or clearing releases the old Object URL.
5. Model and dictionary files use the package-provided GitHub URLs. `next.config.ts` aliases `onnxruntime-web` to its external-WASM `ort.min.mjs` entry for both Turbopack and Webpack, and the OCR Worker points that runtime at the matching versioned jsDelivr `dist/` path. The Turbopack alias must remain project-relative because Turbopack cannot resolve Windows absolute import strings; only the Webpack fallback converts it with `path.resolve`. Do not restore the package's default `ort.bundle.min.mjs` entry: it makes Turbopack emit the 25+ MiB `ort-wasm-simd-threaded.jsep.wasm` file into `_next/static/media`, which exceeds Netlify's single-file limit even though the runtime URL is later replaced. There are no local model/WASM assets, Service Worker caches, COOP/COEP headers, or Netlify header changes; first use therefore requires network access and later loads depend on normal browser HTTP caching.
6. Recognition boxes remain in original image coordinates and are scaled as percentage overlays in the responsive preview. Clicking a box selects it and highlights the matching text in the result panel; clicking image whitespace clears the selection. Only the bottom-right zoom control opens the shared `ImagePreviewDialog` for zoom and pan. The editable result remains independent from box geometry and can be copied or downloaded as `<original filename>.ocr.txt`.

## Build And Generated Files

Scripts in `package.json`:

- `dev`: Next dev on port `2025` with Turbopack.
- `predev`: runs `pnpm generate:word-cloud`.
- `generate:word-cloud`: runs `scripts/generate-word-cloud.cjs`.
- `prebuild`: runs `pnpm generate:word-cloud`.
- `build`: Next build with Turbopack.
- `svg`: regenerates `src/svgs/index.ts`.
- `test:codex-session`: runs the synthetic Vitest suite for the browser-only Codex Session parser.
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

Origin health check:

- `GET /healthz` and `HEAD /healthz` return `204` with `Cache-Control: no-store` and do not touch external services.
- The redirect router should probe this path on each of the `e`, `n`, and `v` origins instead of probing the rendered homepage.

Cache headers are configured for:

- `/images/*`
- `/audio/*`
- `/blogs/*`

## Toolbox Agent Capability Center

`/toolbox/agent` is the product-level entry for the portable WinriseF Toolbox Agent. It renders the one-shot `agent-ready` protocol-registration result inline, removes that query parameter from browser history, and links to the currently available native-backed tools: LAN transfer/native acceleration and the Git/SVN version-control workbench. A neutral visit does not claim that a resident process is online because the Agent is intentionally headless and starts only for a requested feature.

The page uses the shared `/images/toolbox/winrisef-toolbox-agent.png` brand asset. The source asset is maintained in the sibling image repository and mirrored under the same public path. Feature-specific launch callbacks remain owned by `/t/native-agent-return` and `/toolbox/version-control/agent-return`; the capability center is not an authentication callback endpoint.

## Codex Session Parser

`/toolbox/codex-session` imports one user-selected Codex `rollout-*.jsonl` and keeps the source `File` only in current-page memory. It does not scan `.codex`, upload or persist the file, use an API route, connect to the Toolbox Agent, execute commands, or access paths mentioned inside the Session.

The frontend is split into two boundaries:

- `src/lib/codex-session/` owns the Worker protocol, `stream-chain` Web Stream JSONL ingestion, physical line/byte indexing, permissive Zod validation, Codex record normalization, tool-protocol normalization, `call_id` correlation, restricted Acorn static analysis of outer `exec` JavaScript, Tree-sitter Shell analysis, authoritative command/file audit aggregation, and recorded-only Token accounting.
- `src/app/toolbox/codex-session/` owns file selection/drop, parse progress and cancellation, the Session audit summary, the three fixed command/file/Token views, view-local search and filters, TanStack-virtualized lists, the dynamically loaded Recharts graph, focused command/file/Token details, and the on-demand patch Diff modal.

The main thread sends the original `File` to `parser.worker.ts`. The Worker streams bytes through the JSONL parser, normalizes the Session, and then loads `public/wasm/codex-session/` grammars to analyze Shell batches off the main thread. It returns periodic byte/record progress followed by one audit-focused `SessionParseResult` containing final diagnostics. Process, file, and Token evidence retains its source reference, but the product does not expose raw JSONL history. Session strings are rendered through React text nodes or `<pre>` and never through `dangerouslySetInnerHTML`. Replacing or cancelling an import terminates the Worker and advances a request generation so stale results are ignored. Worker initialization failure is surfaced directly and has no whole-file main-thread fallback.

`web-tree-sitter` ships one browser/Node entry containing guarded imports of `fs/promises` and `module`. `next.config.ts` maps those imports to `browser-node-stub.ts` only for browser bundles so Turbopack can resolve the shared entry; the Worker still takes the package's browser branch and fetches WASM from `public/wasm/codex-session/`. Webpack has matching browser fallbacks. The stubs throw if a Node-only branch is ever reached in the browser instead of silently masking an invalid runtime path.

Calls and outputs are correlated by `call_id`, including output-first, interleaved, missing, and duplicate cases. The command protocol normalizes legacy `exec_command`, current `tools.shell_command`, and Responses API `local_shell_call` / `local_shell_call_output` records. `custom_tool_call(name="exec")` is parsed but never evaluated: only a bounded literal/constant/template/collection subset can emit nested calls, with stable `<outerCallId>:<ordinal>` IDs. Results are assigned to an inner call only when the static data flow proves one unique target; a shared result from parallel inner calls remains unknown and does not invent per-call success. Process continuations use recorded session/cell identifiers. Missing explicit exit/success evidence remains unknown instead of defaulting to success.

File audit evidence is intentionally narrow. Read files come only from explicit local read-tool input paths or literal paths passed to recognized read commands such as `Get-Content`, `cat`, and `sed`. Search commands such as `rg`, `grep`, and `Select-String` increment a search-operation counter but their output paths are never expanded into the file list. Modified files come only from `event_msg.patch_apply_end` records whose `success` field is `true`; rejected or failed patches increment the failed-attempt counter and contribute no changed files. Repeated paths are merged, and successful patch records retain operation type and their recorded unified diff. `@pierre/diffs` parses complete patches; file-header-free hunks and pure create/delete fragments are normalized into parseable patches, while irrecoverable loose fragments keep a conservative line-count fallback. File and summary additions/deletions are cumulative successful-patch activity, not a final net repository diff. Opening any patch record shows that file's complete chronological patch stack in one wide Diff modal with unified/split layout and local Diff theme controls. Assistant prose, directory listings, search output, and speculative tool-name matching are not file evidence.

Command analysis deliberately separates a recorded execution batch from the executable command nodes inside it. PowerShell, Bash, and CMD dialects are detected from explicit hints and syntax, then parsed with Tree-sitter. Literal `bash -lc`, `pwsh -Command`, `cmd /c`, WSL, and Docker exec/run Shell wrappers are recursively expanded to a bounded depth. `local_shell_call` argv arrays remain structured direct-process arguments, so metacharacters inside one argument cannot become fabricated pipelines or extra commands. When a grammar reports an error, a quote-aware conservative fallback extracts only known commands in provable command positions; structurally damaged scripts and dynamic command names remain partial instead of being counted as confirmed.

The command audit includes Git, Docker, package managers, build/test tools, language runtimes, network commands, explicit file mutations, important system commands, and otherwise identifiable external programs. Read/search/list/formatting helpers and Shell wrapper nodes stay out of command totals. The command view presents human-readable purpose labels, stable command-signature frequencies, batch success/failure/unknown totals, view-local search, execution mode, and loop/conditional/pipeline/nested context. A command detail shows that node, its containing script, and the recorded batch output separately. Exit code and completion state always belong to the whole execution batch; the UI does not claim that each command inside a loop, condition, pipeline, or parallel aggregate succeeded independently.

Token totals come only from `event_msg.payload.type === "token_count"`. The final valid monotonic `total_token_usage` is the Session total; cumulative records are never summed. Input includes cached input, output includes reasoning output, and both subsets are shown without double counting. The view also derives request count, request average, request peak, cache rate, context-window utilization, and fresh/cached/output request trends from recorded `last_token_usage` samples. Missing usage is displayed as unavailable, decreasing cumulative totals are hidden as invalid, and fork/subagent Sessions are marked as possibly inherited. There is no tokenizer fallback or cost estimate.

## Architectural Risks And Constraints

## Local Version Control Workbench

`/toolbox/version-control` is the Windows desktop Chromium entry for the read-only Git/SVN workbench. It keeps the existing full-screen toolbox surface after a repository is selected; `/toolbox/version-control/agent-return` is the short-lived custom-protocol callback handoff page.

The frontend is split into two boundaries:

- `src/lib/version-control/` owns Version Control Bridge V2, callback validation, the 64KiB control-frame codec, source preview streams, the Pierre input adapter and parse Worker, graph layout, repository candidates, and the Zustand session store.
- `src/app/toolbox/version-control/` owns launch/setup UI, explicit Git/SVN candidate selection, the virtualized single-lane-compatible commit graph, working-tree groups, file tree, Pierre-styled diff modal, conflict perspectives, and export confirmation.

The page launches the existing portable EXE with `winrisef://launch?...&feature=version-control`. This mode is mutually exclusive with `/t` native acceleration and accepts only a pinned loopback WebTransport endpoint at `/winrisef/version-control/v2`. Every Agent process grants repositories through the native directory picker. Git is read through vendored libgit2; SVN is read through the controlled system `svn.exe` command line with bounded output, `--non-interactive`, `--no-auth-cache`, no shell, and the authorized working-copy root as the child process current directory. Local SVN targets are relative to that root; URL/peg targets are kept separate from local paths. SVN working-copy differences use BASE-to-WORKING semantics and derive the normal local file list from `svn status`; historical comparisons keep `svn diff --summarize` separate from mixed-revision working-copy state. If a selected directory contains both Git and SVN metadata, the Agent returns opaque candidates and the browser requires an explicit choice. The browser never submits an arbitrary local path and does not persist recent repositories.

Control commands and paged metadata remain below 64KiB. Preview bodies use independent incoming WebTransport streams. `@pierre/diffs` is the only code-diff renderer: SVN `仅变更` parses the already-generated per-file Patch, while Git and each backend's `完整文件` mode parse the two UTF-8 source sides. A dedicated browser Worker converts both inputs into `FileDiffMetadata`, is replaced when the source key changes, and has one main-thread fallback when Worker startup fails; the React surface renders that metadata through one virtualized `FileDiff`, using Pierre's file header, hunk separators, word-level highlights, and split/unified layouts. The Diff initially follows the active website time theme through `useTimeTheme`: dawn, noon, sunset, and night map to `catppuccin-latte`, `vitesse-light`, `rose-pine-dawn`, and `poimandres`; two compact controls cycle that group or Pierre's official `pierre-light`/`pierre-dark` pair. A manual Diff choice remains local to the current page session, while returning from the official group restores live website following. Theme changes update only Pierre options and the modal's surface variables, so they do not request preview bodies, restart the parse Worker, alter `modelKey`, or discard scroll and expanded-hunk state. Git mode changes only expand or collapse unchanged lines and do not refetch or reparse its already-loaded full sources. SVN files whose full bodies exceed the 2MiB-per-side limit open in Patch mode by default; binary files, directories, oversized full previews, strict Patch parse failures, and property-only changes receive dedicated error or empty states. Rapid history selections are debounced and serialized with a latest-generation guard, so stale comparisons cannot replace the current selection or request pages from an expired Diff session; history search and pagination use the same stale-response guard and merge identical in-flight pages. The file tree is built with one path map and stores each directory's selectable file IDs instead of rescanning the full Diff on every render. Its A/M/D/R status counters are multi-select filters; conflicts add a C filter only when present, and hiding a status also removes those hidden files from the export selection. The Diff modal closes through its close control, Escape, or a direct click on the surrounding backdrop without treating clicks inside the review surface as dismissals.

Git operations remain read-only: history, refs, status, stash inspection, arbitrary revision comparison, and refresh are permitted; checkout/switch, index writes, commits, reset/restore, and stash mutation do not exist in the protocol. SVN starts as a read-only working-copy/history backend: status and BASE-to-WORKING previews are available, while staging and SVN export are advertised as unavailable until their backend-specific semantics are complete. SVN history is not read automatically; the UI shows a `连接并读取历史` action and the Agent asks for native confirmation before contacting the repository URL. SVN history uses the existing commit graph renderer with one linear parent lane (`rN → rN-1`) and does not invent branch topology. The browser compresses selected file IDs into the shorter include/exclude range representation before Git `prepare-export`; the Agent validates and expands those ranges against the authorized Diff. Git export remains the only local write exception and uses the native save dialog, a second in-repository confirmation, a same-directory temporary file, and atomic replacement. Clipboard copy stays entirely in the browser.

Git V2 supports normal repositories, linked worktrees, bare repositories, gitlinks, staged/unstaged/untracked/conflicted views, first-parent commit inspection, and stash display. SVN V2 supports working-copy detection, local status, mixed-revision indicators, linear history after explicit network consent, revision/workspace comparisons, and text previews through the system SVN CLI. The Agent locates `svn.exe` once per process, then uses `svn info --xml` to validate it and identify each selected working copy; it derives the normal BASE-to-working file list directly from the cached verbose status response, loads two historical full-file preview sides concurrently, and retains a bounded revision/path source cache across Diff sessions while clearing working-copy bodies on refresh. Historical and arbitrary-revision file lists keep `svn diff --summarize` for authoritative state metadata. Every SVN Diff incrementally parses `svn diff --git` stdout through a fixed 64KiB buffer, preserving complete line counters and binary metadata without retaining the aggregate output. Per-file Patch bodies are retained up to 2MiB inside a bounded cache of at most three revision ranges and 32MiB; a body omitted by the cache budget is reloaded with a path-scoped Diff only when that file is opened. The global stream has a counted 512MiB processing budget and a 120-second timeout, neither of which is preallocated. Malformed byte sequences are replaced only when a retained text Patch is finalized, instead of failing the whole workspace. Unversioned working-copy text files use a bounded local read because SVN omits them from its Diff. It intentionally does not read `.svn/wc.db`, invoke shell commands, recurse into externals, or enable `svn+ssh://` tunnels.

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
