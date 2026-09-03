# Content And Reading

## Purpose

Owns repository-managed pages: blog Markdown, article metadata, images, Markdown rendering, reading UI, news, and likes.

## Key Paths

| Path | Use it for |
| --- | --- |
| `public/blogs/<slug>/config.json` + `index.md` | One article's metadata and body. |
| `public/blogs/index.json` | Blog list metadata. |
| `public/blogs/word-cloud.json` | Generated word-cloud output. |
| `src/app/blog/` | Blog list/detail routes. |
| `src/lib/load-blog.ts` | Article fetch/cache. |
| `src/hooks/use-markdown-render.tsx` + `src/lib/markdown-renderer.ts` | Worker/main-thread Markdown pipeline. |
| `src/components/blog-preview.tsx` | Article reading shell. |
| `src/lib/news.ts`, `src/lib/english-reading.ts`, `src/app/api/` | News and English-reading data normalization. |
| `src/app/news/english-reading/` | English-reading list and detail routes. |
| `supabase/functions/like/`, `supabase/migrations/` | Like endpoint and data model. |

## Main Flow

The index fetches `index.json`; an article fetches its paired JSON/Markdown files. Markdown normally renders in a Worker, then becomes TOC, Shiki code blocks, Mermaid placeholders, safe links, and shared image preview. News handlers normalize remote sources. The news landing page rotates between the daily digest and the latest English reading; both card sizes remain in one grid layer to prevent layout shifts, while auto-flip pauses for reduced motion, page invisibility, focus, or direct interaction. English reading uses its own `news/english-reading/list.json`, with each detail page loading the matching Markdown and optional audio. The NewsNow focus card is collapsed by default and loads its live feed only when opened. Dated news detail pages probe `/news/bili/audio/<date>.mp3` through metadata loading and show the player below the date only when the asset exists. Likes call the external Supabase function.

## Pay Attention

- Keep article JSON, Markdown, index, generated word cloud, and image paths in sync. The article index uses one HTTP cache policy: 10 minutes, then mandatory revalidation; do not add client-side persistent caching for it.
- Blog detail is client-rendered; do not assume server-rendered article HTML.
- Sidebar must remain native sticky; progress must use cached scroll range; code containment needs measured height.
- Source images belong in sibling `2025-blog-img`, not newly under this repo's `public/`.
- Do not manually edit generated `word-cloud.json`; use its script when generation is requested.
- `sitemap.xml` and `robots.txt` directories are not implemented routes.
