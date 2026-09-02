import { useEffect, useState } from 'react'

const BLOG_INDEX_URL = '/blogs/index.json'

export type BlogIndexItem = {
	slug: string
	title: string
	tags: string[]
	date: string
	summary?: string
	cover?: string
}

export function useBlogIndex() {
	const [items, setItems] = useState<BlogIndexItem[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		const controller = new AbortController()

		async function loadIndex() {
			try {
				const res = await fetch(BLOG_INDEX_URL, { signal: controller.signal })
				if (!res.ok) throw new Error('Failed to load blog index')
				setItems((await res.json()) as BlogIndexItem[])
				setError(null)
			} catch (error) {
				if (controller.signal.aborted) return
				setError(error instanceof Error ? error : new Error('Failed to load blog index'))
			} finally {
				if (!controller.signal.aborted) setLoading(false)
			}
		}

		void loadIndex()
		return () => controller.abort()
	}, [])

	return {
		items,
		loading,
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
