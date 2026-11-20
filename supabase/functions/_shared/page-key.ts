// Public page routes. Transfer links are counted under a template before leaving the browser.
const pages = new Set([
	'/', '/about', '/blog', '/bloggers', '/calendar', '/changelog', '/game', '/home', '/music', '/news',
	'/news/english-reading', '/orbitalis', '/pictures', '/projects', '/share', '/svgs', '/t', '/toolbox',
	'/toolbox/agent', '/toolbox/codex-session', '/toolbox/compress', '/toolbox/database', '/toolbox/face-mask',
	'/toolbox/markdown', '/toolbox/ocr', '/toolbox/password', '/toolbox/protractor', '/toolbox/ruler', '/toolbox/version-control',
	'/toolbox/zip', '/world-clock'
])

export function isArticleKey(path: string) {
	return /^\/blog\/[a-zA-Z0-9_-]{1,180}$/.test(path)
		|| /^\/news\/\d{4}-\d{2}-\d{2}$/.test(path)
		|| /^\/news\/english-reading\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(path)
}

export function isPageKey(key: string) {
	return pages.has(key) || isArticleKey(key) || key === '/t/[code]' || key === '/t/lan/[roomId]'
}

export function pageKeyForPath(pathname: string) {
	const path = pathname.replace(/\/+$/, '') || '/'
	if (pages.has(path) || isArticleKey(path)) return path
	if (/^\/t\/[A-HJ-NP-Z2-9]{6}$/i.test(path) && path !== '/t/status') return '/t/[code]'
	if (/^\/t\/lan\/[A-Za-z0-9_-]{8,64}$/.test(path)) return '/t/lan/[roomId]'
	return null
}
