# Operations, Deployment, And Global Risks

## Purpose

Contains the cross-module stack, repository map, build/deployment setup, external service boundaries, test policy, and global maintenance risks.

## Key Paths

| Path | Use it for |
| --- | --- |
| `package.json` | Dependencies and scripts. |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Build-script allowlist, transitive security fixes and reproducible dependency resolution. |
| `next.config.ts`, `tsconfig.json` | Next/browser aliases, redirects, TypeScript behavior. |
| `netlify.toml` | Netlify build, Node version, plugin, cache headers. |
| `edgeone.json` | Relay cleanup schedule. |
| `supabase/`, `edge-functions/`, `cloud-functions/` | Likes, public relay APIs, and the Node.js scheduled cleanup worker. |
| `scripts/`, `tests/`, `vitest.config.ts` | Generated artifacts and unified Vitest suites (`tests/**`). |

## Main Architecture

Next.js 16 + React 19 + TypeScript/Tailwind deliver the public site. Markdown/JSON live in the repository. Next handlers proxy news; Supabase owns likes/LAN Realtime; EdgeOne owns public relay; the portable Agent exposes optional native capability.

## Pay Attention

- Unit and contract tests are unified under `vitest.config.ts:1` (`tests/**/*.test.*`, node, 20s timeout, `sequence.concurrent:false`). Use `pnpm test`; use `pnpm test:coverage` only when an explicit coverage report is needed.
- `tests/e2e/*.spec.ts` are Playwright-shaped browser scenarios but are not collected by Vitest and do not yet have a checked-in Playwright runner. Do not count them as executed coverage until that runner is configured.
- Do not run package scripts for verification unless explicitly requested.
- `predev`/`prebuild` generate word cloud; `svg` regenerates SVG index. Treat generated output as non-primary source.
- Netlify is the checked-in deployment path: Node 22, `pnpm run build`, `.next`, Next plugin; EdgeOne cleanup runs 02:00 Asia/Shanghai.
- EdgeOne's daily cleanup schedule targets the Node.js Cloud Function `/api/transfer-cleanup`, not the paginated manual Edge endpoint `/api/transfer/cleanup`. The Node runtime reuses the existing Blob deploy credential; `cloudFunctions.nodejs.maxDuration` is 120 seconds. Keep both function directories in EdgeOne deployments and report incomplete scheduled runs as failures rather than HTTP 200 successes. See [Public transfer](./public-transfer.md) for page and authorization boundaries.
- `/healthz` is the no-store 204 probe; use it instead of a rendered home page for origin checks.
- `next.config.ts` explicitly sets `typescript.ignoreBuildErrors: false`; production builds fail on TypeScript errors. A successful build still does not replace browser or business-flow acceptance.
- Next `16.3.8` and TypeScript `5.9.3` are pinned for the current build. TypeScript distinguishes ordinary and shared byte backing memory; `src/lib/array-buffer.ts` preserves ordinary views without copying and supplies ordinary memory for DOM file sinks.
- React and React DOM are both pinned to `19.2.1`. The previous `react-dom@19.2.0` pin caused an incompatible-version runtime error against React `19.2.1`; keep their exact versions aligned.
- Production dependency security fixes include Mermaid `11.16.1`, its DOMPurify resolution `3.4.16`, and baseline-browser-mapping `2.11.0`; targeted overrides hold Browserslist at `4.28.7` and Mermaid's KaTeX at `0.18.2`. Keep these security floors until upstream dependency ranges include their fixes, and exercise Mermaid mathematical labels when changing KaTeX. An audit result is time-specific and covers registry advisories, not every runtime/CDN dependency or application vulnerability. Validate the exact release snapshot: results from a workspace containing deferred features do not prove the split commit was tested independently.
- Production and development use Turbopack with React Compiler enabled. A Linux/Docker `conflicting effects for the same key` panic was isolated to the image and Office Worker entries: Next's [React Compiler prefilter](https://github.com/vercel/next.js/blob/v16.3.8/crates/next-core/src/next_shared/webpack_rules/babel.rs) matches `/>` inside triple-slash library references. Keep the `webworker` library reference in `global.d.ts`, outside runtime Worker entries. Moving only these declarations eliminated the reproduced panic; the full Docker production build passed compilation, TypeScript and all 35 static-generation tasks. The user's Windows build already passed before this adjustment; the deeper platform-specific Turbopack defect remains unconfirmed.
- Keep service-role keys, relay salts/admin hashes, Blob credentials, invite tokens, and sensitive diagnostics out of browser code/docs/logs.
- Blog metadata/Markdown/word-cloud/images can drift; images remain in sibling `2025-blog-img`.
- Empty sitemap/robots directories are not routes. README's Vercel note is optional; Netlify is the checked-in configuration.
