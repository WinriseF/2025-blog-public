import { DEFAULT_BLOG_COVER } from '@/consts'
import { getAssetUrl } from '@/lib/asset-url'

export function getBlogCover(cover?: string | null): string {
	const normalizedCover = cover?.trim()
	return normalizedCover ? getAssetUrl(normalizedCover) : DEFAULT_BLOG_COVER
}
