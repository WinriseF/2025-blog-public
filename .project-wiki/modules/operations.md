# Operations, Deployment, And Global Risks

## Purpose

Contains the cross-module stack, repository map, build/deployment setup, external service boundaries, test policy, and global maintenance risks.

## Key Paths

| Path | Use it for |
| --- | --- |
| `package.json` | Dependencies and scripts. |
| `next.config.ts`, `tsconfig.json` | Next/browser aliases, redirects, TypeScript behavior. |
| `netlify.toml` | Netlify build, Node version, plugin, cache headers. |
| `edgeone.json` | Relay cleanup schedule. |
| `supabase/`, `edge-functions/` | Likes and public relay backends. |
| `scripts/`, `tests/`, `vitest.config.ts` | Generated artifacts and unified Vitest suites (`tests/**`). |

## Main Architecture

Next.js 16 + React 19 + TypeScript/Tailwind deliver the public site. Markdown/JSON live in the repository. Next handlers proxy news; Supabase owns likes/LAN Realtime; EdgeOne owns public relay; the portable Agent exposes optional native capability.

## Pay Attention

- Tests are unified under `vitest.config.ts:1` (`tests/**/*.test.*`, node, 20s timeout, `sequence.concurrent:false`). Use `pnpm test` only.
- Do not run package scripts for verification unless explicitly requested.
- `predev`/`prebuild` generate word cloud; `svg` regenerates SVG index. Treat generated output as non-primary source.
- Netlify is the checked-in deployment path: Node 22, `pnpm run build`, `.next`, Next plugin; EdgeOne cleanup runs 02:00 Asia/Shanghai.
- `/healthz` is the no-store 204 probe; use it instead of a rendered home page for origin checks.
- `typescript.ignoreBuildErrors` means a successful build is not a type check.
- Keep service-role keys, relay salts/admin hashes, Blob credentials, invite tokens, and sensitive diagnostics out of browser code/docs/logs.
- Blog metadata/Markdown/word-cloud/images can drift; images remain in sibling `2025-blog-img`.
- Empty sitemap/robots directories are not routes. README's Vercel note is optional; Netlify is the checked-in configuration.
