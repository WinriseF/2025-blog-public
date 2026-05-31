const DEFAULT_ASSET_ORIGIN = 'https://img.winrisef.top'

export const ASSET_ORIGIN = (process.env.NEXT_PUBLIC_ASSET_ORIGIN || DEFAULT_ASSET_ORIGIN).replace(/\/$/, '')

export function getAssetUrl(value?: string | null): string {
	const path = value?.trim()
	if (!path) return ''
	return path.startsWith('/') ? `${ASSET_ORIGIN}${path}` : path
}
