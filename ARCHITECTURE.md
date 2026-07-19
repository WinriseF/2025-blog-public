# Project Architecture

Last updated: 2026-07-17.

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
- `/toolbox`: toolbox directory page with links to `/toolbox/compress`, `/toolbox/markdown`, `/toolbox/face-mask`, `/toolbox/password`, and `/t`.
- `/toolbox/compress`: image compression tool.
- `/toolbox/markdown`: local Markdown preview tool.
- `/toolbox/face-mask`: local privacy masking tool for face detection, manual rectangular masks, and original-size image export.
- `/toolbox/password`: browser-only random password, passphrase, and PIN generator.
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

Toolbox UI uses short `motion/react` entry, upload-state, and button-press feedback with reduced-motion opt-outs. Transfer progress and connection state keep their existing lightweight CSS transitions to avoid animation work on high-frequency events.

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
3. LAN Session V10 is a full-viewport chat-style workbench instead of a panel inside the toolbox shell. Entering LAN mode renders an independent QQ-like app surface that covers the original toolbox layout and route chrome. Desktop renders a two-column layout: a device/session sidebar with the live connection list on the left, and the selected connection's full chat window on the right. Mobile renders two layers: a device page first, then a pure chat page with only the fixed chat header, independently scrolling message stream, and fixed composer. The message stream follows QQ-style grouping with centered time pills, incoming sender labels above the bubble, constrained text/image/file bubble widths, and no separate per-message timestamp row. There is no standalone file panel or mobile file tab; files stay as chat attachments. While the LAN workbench is mounted, `src/hooks/use-lan-screen-wake-lock.ts` requests a Screen Wake Lock by default and releases it on exit. The device view exposes a persisted opt-out switch; browser or OS release while hidden is followed by a fresh request when the page becomes visible again, while unsupported or rejected Wake Lock never blocks transfer. Immediately below that switch, the device view exposes `极速模式`. The Windows Agent is distributed as one portable EXE with no installer, service, tray, startup entry, or self-copy. A no-argument double-click registers the EXE's current path as the current user's `winrisef://` handler, opens `/t?agent-ready=1` (or `0` on failure), and exits; `src/app/t/transfer-page-client.tsx` shows the result and removes that one-shot query parameter. Moving or renaming the EXE requires another double-click to repair the registered path. WebTransport-capable desktop browsers can then launch the headless Agent through `winrisef://`; the Agent accepts only its built-in production Origin, loopback development Origins, or exact HTTPS Origins explicitly embedded during protocol registration. `src/app/t/native-agent-return/` consumes the HTTPS fragment callback and hands it to the original tab through exactly one transport: BroadcastChannel when available, otherwise a localStorage event fallback. The original tab deduplicates callbacks by launch nonce and ignores stale asynchronous connection results before `src/lib/lan-transfer/native-agent/local-bridge.ts` consumes the one-time launch token over a pinned loopback WebTransport Bridge. Phone/tablet views never launch or install an Agent. Once connected, the installed browser publishes only the Agent endpoints and certificate hash through `LanCapability`; the remote pure webpage requests a short-lived one-time ticket over the existing encrypted WebRTC control path and can run the four-lane browser↔Agent memory benchmark in `peer-webtransport.ts`. Benchmark v2 uses deterministic 16MiB stripes so a 64MiB run engages all four lanes, measures payload only after the control acknowledgement, requests WebTransport's throughput congestion-control hint and unreliable/HTTP3 transport, keeps two bounded writes in flight per browser lane, and uses zero-copy payload handling in the Rust benchmark. It requires the Agent's default low-volume log filter plus one end-of-payload QUIC path summary; packet-level Quinn/Rustls trace is forbidden during performance acceptance. Benchmark bytes never pass through the installed browser. If both desktop pages publish an Agent, stable device-ID ordering keeps only one active advertisement. Normal chat and attachments continue over existing WebRTC until both benchmark directions reach 90% of the same-direction baseline and the later native file-I/O data plane is implemented.
4. Any device can create a pairing QR code as WebRTC `host`; any number of other devices can scan `/t#mode=lan&room=<roomId>&token=<roomToken>` and join that room as separate `guest` peers. The host keeps the same QR/link available so more devices can join later. WeChat and QQ embedded browsers first show a dialog that offers either copying the invite into a normal browser or continuing the LAN session in the embedded browser despite possible file limitations. Continuing stores the invite and removes its raw token from the address bar just like the normal-browser path. Normal browsers enter the LAN session immediately and store only the current V10 invite in sessionStorage.
5. The QR token stays browser-side. The browser hashes it locally and sends only `tokenHash` in Supabase Realtime payloads.
6. Both browsers subscribe to the public Realtime channel `lan-transfer:<roomId>`, track peer presence, and use Broadcast only for the `lan` signaling event. A stable localStorage `deviceId` keys the long-lived conversation/runtime, while a volatile `instanceId` identifies the current page instance. V10 signaling also carries `generation`, `negotiationId`, `messageId`, `seq`, and an optional hard-recovery request, so stale connection generations and stale negotiation candidates are discarded and soft ICE recovery is not confused with a required Transport rebuild. The stable English friendly name and random DiceBear `avatarSeed` remain device-local metadata.
7. Supported V10 signaling messages are `announce`, `reconnect-request`, `rebuild`, `ice-restart`, `offer`, `answer`, `candidate`, `signal-ack`, and `peer-left`. The host owns each guest connection generation and is the only side that creates offers; guests request recovery and answer host offers. Rebuild/restart/offer/answer messages use application-level ACK, bounded resend, and message-id deduplication. Candidate delivery is duplicate-tolerant and cached by `generation + negotiationId` until the matching remote description is installed. IPv4 and IPv6 Candidates are passed through unchanged; the application does not filter an address family or rewrite SDP, leaving path selection to browser ICE.
8. `src/lib/lan-transfer/signal-client.ts` tracks Realtime independently as `connecting`, `online`, `retrying`, `offline`, or `closed`. Supabase Realtime runs its own heartbeat in a Web Worker where supported and uses the SDK's channel rejoin/backoff instead of an application timer that removes and recreates Channels. Every resubscribe re-tracks Presence, announces the local instance, and flushes pending critical signals and queued Candidates. Page focus, visibility restore, `online`, `pageshow`, and Network Information changes request an immediate socket wake and connection health pass.
9. `src/lib/lan-transfer/native-webrtc-transport.ts` owns one native `RTCPeerConnection` generation and the single reliable ordered `lan-session-v10` DataChannel. It implements SDP exchange, per-negotiation Candidate buffering, bounded backpressure, transport hello/ready, native `restartIce()`, connection-state events, selected-candidate route/health inspection, and pre-transfer binary frame-size probing. Liveness never uses ping/pong on the ordered file channel: `getHealthStats()` reads ICE state plus the selected Candidate Pair's `bytesSent`, `bytesReceived`, `consentRequestsSent`, and `responsesReceived`, which are not delayed behind queued file frames. Chunk negotiation probes a 128KB frame with a 124KB payload, then falls back to a 64KB frame with a 60KB payload. `inspectRoute()` exposes only structured family/type labels (`IPv6 直连`, `IPv4 局域网直连`, `IPv4 NAT 直连`, `IPv4 直连`, or `未知直连`); complete addresses are never stored in view state or rendered. STUN (`stun:stun.l.google.com:19302`) is used only for candidate discovery; there is intentionally no TURN or WebSocket file relay fallback.
10. Once connected, each host/guest pair is an equal WebRTC data connection. Either side can send text messages, recorded voice messages, images, or files to the currently selected peer. `src/lib/lan-transfer/reconnect-coordinator.ts` owns the per-device connection state machine and replaces only the temporary Transport. `src/lib/lan-transfer/connection-runtime.ts` remains the device session core for protocol dispatch, file queues, received ranges, progress, cancellation, same-page resume, and chat history. `src/app/toolbox/use-lan-transfer-engine.ts` keeps one Runtime per stable device and rejects data or async completion callbacks from an obsolete Transport id/epoch.
11. Chat message list order is the local session insertion order so peer clock skew cannot reorder visible history; sender-created `createdAt` is retained for time display only. Text messages show one check only after they are written to the DataChannel and two checks only after the receiving runtime accepts the message and returns `chat-receipt`; this is a delivery receipt, not a read receipt. Attachment offers reuse the original attachment message time for display. Images and voice messages render as media bubbles once cached, while ordinary files render as file cards that wait for the receiver's download action.
12. V10 DataChannel control messages include `capability`, `native-agent-ticket-request`, `native-agent-ticket-response`, `chat-message`, `chat-receipt`, `chat-history`, `attachment-offer`, `attachment-accept`, `attachment-progress`, `attachment-complete`, `attachment-received`, `attachment-cancel`, `resume-query`, and `resume-state`. Native Agent advertisements never contain a token; the remote peer requests a fresh ticket immediately before each benchmark and receives it only over the established encrypted DataChannel. Control messages carry `protocolVersion`, `peerId`, `seq`, and `createdAt` where applicable. Resume messages additionally carry `resumeId`, `transportGeneration`, and the sender runtime's `transportEpoch`; responses that do not match the current connection attempt are ignored. `chat-history` syncs text/system messages and attachment metadata after reconnect, batches receipts for remote outbound text, and treats the remote inbound history as proof that matching local outbound text was delivered. It does not replay file/media bytes or send object URLs. Attachments use `attachmentId + chunkIndex` for ordered validation and idempotent writes. Binary chunks do not carry an application-layer CRC32; integrity relies on WebRTC DTLS, SCTP, and exact final file-byte and chunk-count checks before completion is acknowledged.
13. Multiple selected files are sent as independent attachments in one message, not as a ZIP. Each attachment has its own progress, completion, failure, and file-record state. One `LanAttachmentSendScheduler` per device connection is the only attachment-frame writer. It interleaves accepted attachments over the same reliable ordered DataChannel with byte-based weighted round robin: ordinary files receive 512KB turns, while images, voice messages, and files up to 8MB receive up to 2MB turns. Connections between two desktop peers admit at most four active attachments; if either endpoint is Android or iOS, the conservative mobile profile admits at most two so both sender read-cache memory and receiver write pressure stay bounded. A newly accepted priority attachment may pause an active bulk attachment and release its 4MB read cache. Per-attachment disk-unconfirmed data is capped at 16MB on desktop or 8MB with the mobile profile, while the aggregate caps are respectively 64MB and 32MB. Once an attachment's final missing chunk and ordered `attachment-complete` message are queued, it immediately releases its active slot and waits independently for `attachment-received`; final save confirmation never owns the scheduler or blocks another eligible attachment.
14. Voice uses browser `MediaRecorder` to create a voice-message attachment. It is not a realtime voice call feature. Voice attachments are automatically cached as browser object URLs and rendered with `@arraypress/waveform-player` as interactive waveform chat bubbles.
15. Incoming image and voice attachment offers are accepted automatically and cached for in-chat display without opening the browser download flow. Chat images open in a full-screen preview with mouse-wheel and touch-pinch zoom. Automatic media caching never uses File System Access because it requires a user gesture; it uses memory for small media and OPFS/IndexedDB when needed. Ordinary file attachments still wait for the user to click the file card's download action. After that, desktop browsers with File System Access use direct file save first, then progressively falls back to OPFS, IndexedDB, or memory when needed. Direct File and OPFS merge consecutive chunks for each attachment into about 4MB before each filesystem write, even when chunks from different attachments are interleaved on the channel; checkpoints, final chunks, and finalization flush any smaller remainder. Each active sender task likewise retains one approximately 4MB source-file read cache and slices negotiated payload chunks from it across multiple scheduler turns. Data frames negotiate between 128KB and 64KB limits; payload chunks are respectively 124KB and 60KB so both tiers reserve 4KB for the frame header. The chosen size is fixed before creating the attachment manifest and remains unchanged during resume. Non-direct file storage creates an object URL for download and keeps the completed cache until the user leaves or clears it from file management.
16. Same-page reconnect is coordinated per device with `connected → suspect → ice-restarting → rebuilding → backoff`. `src/lib/lan-transfer/connection-health-monitor.ts` samples visible active transfers every 1.5 seconds and idle connections every five seconds. A browser-reported failed/closed ICE path is recovered immediately; a transient disconnected state receives three seconds to recover naturally. While data should be flowing, the monitor first requires evidence that WebRTC sent payload/consent traffic or still has buffered data, then requires ten seconds without either selected-pair receive progress or an ICE consent response before treating the path as dead. Page/network wake watches the next native consent cycle instead of declaring failure from application silence alone. Hidden pages do not fail solely because background timers were throttled. The 60-second DataChannel drain timeout remains only a sender backpressure warning and is never liveness evidence. Entering `suspect` pauses the attachment scheduler without detaching its Runtime or discarding read cursors. Natural recovery or ICE Restart on the same `RTCPeerConnection` resumes that same scheduler directly and does not run range synchronization. ICE Restart has a seven-second timeout; only a closed DataChannel, changed remote page instance, or failed restart detaches the old Transport and starts a full rebuild with a ten-second timeout. Repeated signaling failures retry with capped 0/1/2/4/8-second backoff. A hard-rebuilt Transport stays in `resume-syncing`, where the receiver drains its ordered chunk-write queue, flushes each selected storage engine's checkpoint, and returns one authoritative ranges/bytes snapshot per attachment. The scheduler resets every task's missing-chunk cursor and unconfirmed-byte counters from that response before it resumes; a fully written attachment that still lacks final confirmation sends only `attachment-complete` again. If the global resume snapshot is missing for fifteen seconds, the sender discards stale send cursors, exits the pause, and re-offers every unfinished attachment so each receiver can return its own current checkpoint instead of blocking the whole scheduler indefinitely. Refresh-level or cross-device persistent file resume is not promised.
17. Closing the `X` in a chat header closes only the selected device conversation. It sends a targeted `peer-left`, destroys that device's current WebRTC transport, removes the device-keyed conversation locally, and leaves the LAN room/signaling session alive for other devices. The sidebar/device page keeps a separate global `退出` action for leaving the whole LAN session.
18. LAN large-file support is beta-scoped: 10GB+ is only advertised for peers that pass the real OPFS write probe. IndexedDB fallback is capped to a 1GB recommendation and 2GB experimental maximum because final export still creates a Blob URL from stored chunks.

Important constraints:

- `NEXT_PUBLIC_TRANSFER_API_BASE` is required for the encrypted public relay UI. There is intentionally no Next/Netlify API fallback; if Edge Functions are unavailable, transfer create/open fail.
- Passwords are never sent to the server, but the server does receive a password-derived proof for access control. QR-code password sharing uses URL hash fragments so the password stays browser-side.
- Transfer metadata keeps only the salt, per-chunk IV manifest, proof hash, public details, status, and expiry; KDF settings are fixed in client code.
- Public relay transfer size limits are 4MB for content text or pasted images and 200MB for regular files. Text uses one encrypted chunk; pasted images use the file protocol but are capped to one chunk; public relay files use 4MB plaintext chunks so Edge Functions do not read or return Blob object bodies. Old non-chunked payloads are intentionally unsupported.
- EdgeOne Blob is accessed inside Edge Functions with platform auth. No `EDGEONE_PAGES_PROJECT_ID` or `EDGEONE_API_TOKEN` is needed for this transfer path.
- EdgeOne Function environment variables: `TRANSFER_RATE_SALT` is required, `TRANSFER_ADMIN_PASSWORD_HASH` is required for `/api/transfer/stats` and manual `/api/transfer/cleanup`, `EDGEONE_BLOB_STORE` defaults to `message-transfer`, and `TRANSFER_ALLOWED_ORIGIN` is optional CORS tightening.
- LAN transfer environment variables: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are required in the browser bundle. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted only as a compatibility fallback.
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
