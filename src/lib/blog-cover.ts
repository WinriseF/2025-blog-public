import { DEFAULT_BLOG_COVER } from '@/consts'

export function getBlogCover(cover?: string | null): string {
	const normalizedCover = cover?.trim()
	return normalizedCover || DEFAULT_BLOG_COVER
}
