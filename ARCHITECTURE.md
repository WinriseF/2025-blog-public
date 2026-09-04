# Project Architecture

Last updated: 2026-09-04.

`2025-blog-public` is a personal Next.js content site. Repository Markdown, JSON, and image references are the content source; the frontend is client-rich, while specialized services handle news proxying, likes, encrypted relay transfer, and LAN signaling.

This file is intentionally a **short maintenance entrypoint**. Detailed implementation guidance lives in [`.project-wiki/`](./.project-wiki/INDEX.md), where each major module has one focused document covering its design, implementation, and pitfalls.

## Start Here

| Task | Read |
| --- | --- |
| Any maintenance task | [Project wiki index](./.project-wiki/INDEX.md) |
| Understand runtime, theme, navigation, homepage, or performance | [Frontend](./.project-wiki/modules/frontend.md) |
| Work on articles, Markdown, images, news, likes, or content data | [Content](./.project-wiki/modules/content.md) |
| Work on encrypted public relay or EdgeOne transfer API | [Public transfer](./.project-wiki/modules/public-transfer.md) |
| Work on LAN V14, native Agent transfer, benchmarks, or recovery | [LAN transfer](./.project-wiki/modules/lan-transfer.md) |
| Work on compression, preview, password, face masking, OCR, or Agent center | [Toolbox](./.project-wiki/modules/toolbox.md) |
| Work on Codex rollout parsing and audit | [Codex Session](./.project-wiki/modules/codex-session.md) |
| Work on GitHub, local Git, or SVN review | [Version control](./.project-wiki/modules/version-control.md) |
| Work on stack, scripts, tests, deployment, integrations, or security | [Operations](./.project-wiki/modules/operations.md) |

## Core Architecture

- **Framework:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS.
- **Content:** `public/blogs/` holds article Markdown and metadata; route-local JSON and `src/config/` hold other site content.
- **Global shell:** `src/app/layout.tsx` and `src/layout/` install theme state, atmosphere, navigation, music, and notifications.
- **Backend boundaries:** A Next handler proxies live NewsNow data; dated news and English-reading pages load their remote content directly in Server Components. Supabase owns likes and LAN Realtime signaling; EdgeOne owns the public encrypted relay and its cleanup schedule.
- **Deployment:** `netlify.toml` is the checked-in deployment configuration.

## Directory Map

```text
src/app/          App Router pages and route handlers
src/components/   Shared React UI
src/hooks/        Shared browser hooks
src/lib/          Renderers, workers, integrations, and domain utilities
src/config/       Site configuration JSON
src/layout/       Global layout shell
src/styles/       Global and article CSS
public/blogs/     Articles, article metadata, blog index, generated word-cloud data
scripts/          Generated-data and SVG helpers
tests/            Focused Vitest suites and fixtures
supabase/         Likes function and migration
edge-functions/   EdgeOne transfer relay
.project-wiki/    Compact module-oriented maintenance documentation
```

## Operating Constraints

- Read the relevant project-wiki record before changing code; update it after agent-made source changes.
- Do not run package scripts unless the user explicitly requests it.
- Keep source image assets in the sibling `2025-blog-img` repository rather than adding new images directly under this repository's `public/` directory.
- Treat `public/blogs/word-cloud.json` as generated data, not primary content.
- `next.config.ts` ignores TypeScript build errors, so a successful build is not proof of type correctness.

## Content And Feature Shortcuts

- **Article:** read `public/blogs/index.json`, then the target `config.json` and `index.md`; consult the image policy before touching images.
- **About page:** edit `public/about.md` for rendered content and `src/app/about/list.json` for title/description metadata.
- **Homepage:** read `src/app/(home)/page.tsx`, `src/config/site-content.json`, `src/config/card-styles.json`, and the homepage config store.
- **Markdown rendering:** read `src/hooks/use-markdown-render.tsx`, `src/lib/markdown-renderer.ts`, `src/components/blog-preview.tsx`, then code/image components as needed.
- **News:** read `src/lib/news.ts` and the matching page; read `src/app/api/newsnow/focus/route.ts` when changing live-focus loading.
- **Likes:** read `src/components/like-button.tsx`, the Supabase function, and its migration before changing behavior.

## Documentation Maintenance

- Root [README.md](./README.md) is the concise repository entrypoint.
- `.project-wiki/INDEX.md` routes to eight focused module documents.
- Update the module that owns a behavior change; update this root file only when module routing changes.
- Existing maintenance constraints for coding agents remain in [AGENTS.md](./AGENTS.md).
