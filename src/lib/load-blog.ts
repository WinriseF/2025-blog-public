export type BlogConfig = {
	title: string
	tags: string[]
	date: string
	summary: string
	cover?: string
}

export type LoadedBlog = {
	slug: string
	config: BlogConfig
	markdown: string
	cover?: string
}

const blogCache = new Map<string, LoadedBlog>()

/** Load blog data from public/blogs/{slug}. */
export async function loadBlog(slug: string): Promise<LoadedBlog> {
	if (!slug) {
		throw new Error('Slug is required')
	}

	const cached = blogCache.get(slug)
	if (cached) return cached

	const configRes = await fetch(`/blogs/${encodeURIComponent(slug)}/config.json`, { cache: 'force-cache' })
	if (!configRes.ok) {
		throw new Error('Blog config not found')
	}
	const config = (await configRes.json()) as BlogConfig

	const mdRes = await fetch(`/blogs/${encodeURIComponent(slug)}/index.md`, { cache: 'force-cache' })
	if (!mdRes.ok) {
		throw new Error('Blog not found')
	}
	const markdown = await mdRes.text()

	const blog = {
		slug,
		config,
		markdown,
		cover: config.cover
	}
	blogCache.set(slug, blog)

	return blog
}
