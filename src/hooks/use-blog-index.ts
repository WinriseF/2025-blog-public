import useSWR from 'swr'

const BLOG_INDEX_URL = '/blogs/index.json'
const BLOG_INDEX_CACHE_KEY = 'blog_index:v1'
const BLOG_INDEX_CACHE_TTL = 30 * 60 * 1000

export type BlogIndexItem = {
	slug: string
	title: string
	tags: string[]
	date: string
	summary?: string
	cover?: string
}

type CachedBlogIndex = {
	createdAt: number
	data: BlogIndexItem[]
}

function readCachedIndex(): BlogIndexItem[] | null {
	if (typeof localStorage === 'undefined') return null
	try {
		const raw = localStorage.getItem(BLOG_INDEX_CACHE_KEY)
		if (!raw) return null
		const cached = JSON.parse(raw) as CachedBlogIndex
		if (!Array.isArray(cached.data)) return null
		if (Date.now() - cached.createdAt > BLOG_INDEX_CACHE_TTL) return null
		return cached.data
	} catch {
		return null
	}
}

function writeCachedIndex(data: BlogIndexItem[]) {
	if (typeof localStorage === 'undefined') return
	try {
		localStorage.setItem(BLOG_INDEX_CACHE_KEY, JSON.stringify({ createdAt: Date.now(), data } satisfies CachedBlogIndex))
	} catch {
		// Ignore quota/security errors; SWR still keeps an in-memory cache.
	}
}

const fetcher = async (url: string) => {
	const cached = readCachedIndex()
	if (cached) return cached

	const res = await fetch(url, { cache: 'force-cache' })
	if (!res.ok) {
		throw new Error('Failed to load blog index')
	}
	const items = (await res.json()) as BlogIndexItem[]
	writeCachedIndex(items)
	return items
}

export function useBlogIndex() {
	const { data, error, isLoading } = useSWR<BlogIndexItem[]>(BLOG_INDEX_URL, fetcher, {
		revalidateOnFocus: false,
		revalidateOnReconnect: false,
		revalidateIfStale: false,
		dedupingInterval: 5 * 60 * 1000,
		keepPreviousData: true
	})

	return {
		items: data ?? [],
		loading: isLoading,
		error
	}
}

export function useLatestBlog() {
	const { items, loading, error } = useBlogIndex()

	const latestBlog = items.length > 0 ? [...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] : null

	return {
		blog: latestBlog,
		loading,
		error
	}
}
