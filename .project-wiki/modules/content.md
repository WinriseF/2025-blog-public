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
| `src/lib/news.ts`, `src/lib/english-reading.ts`, `src/app/api/newsnow/` | News, English-reading, and live-focus data normalization. |
| `src/app/news/english-reading/` | English-reading list and detail routes. |
| `supabase/functions/like/`, `supabase/migrations/` | Like endpoint and data model. |

## Main Flow

The index fetches `index.json`; an article fetches its paired JSON/Markdown files. Markdown normally renders in a Worker, then becomes TOC, lazily loaded Shiki code blocks, Mermaid placeholders, safe links, and shared image preview. News handlers normalize remote sources. The news landing page uses one data-driven feature card with explicit daily/English selectors plus optional drag animation; it does not auto-rotate or render hidden sizing copies. News and English-reading archives use server-side query pagination so the browser receives only one page of cards. English reading uses `news/english-reading/list.json` as the title and audio metadata source of truth, and a detail must have both an index entry and matching Markdown. The NewsNow focus card is collapsed by default and loads its live feed only when opened. Dated news details load through `getNewsArticle()` as Server Components and keep probing optional audio through the shared player. Likes call the external Supabase function.

## Pay Attention

- Keep article JSON, Markdown, index, generated word cloud, and image paths in sync. The article index uses one HTTP cache policy: 10 minutes, then mandatory revalidation; do not add client-side persistent caching for it.
- Blog detail is client-rendered; do not assume server-rendered article HTML.
- Sidebar must remain native sticky; progress must use cached scroll range and observe the actual content wrapper so async rendering can invalidate it; code containment needs measured height.
- Source images belong in sibling `2025-blog-img`, not newly under this repo's `public/`.
- Do not manually edit generated `word-cloud.json`; use its script when generation is requested.
- `sitemap.xml` and `robots.txt` directories are not implemented routes.
