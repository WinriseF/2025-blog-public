import { createRequire } from 'node:module'
import path from 'node:path'

// Playwright stays outside production dependencies.
export const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : createRequire(import.meta.url)('playwright')
export const baseUrl = process.env.DATABASE_TEST_URL || 'http://127.0.0.1:2025'

// Use the pinned, installed Monaco assets for deterministic UI checks. Failure
// tests may deliberately block one module while the loader itself succeeds.
export function serveLocalMonaco(page, blockedAsset) {
	return page.route('https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/**', route => {
		const asset = new URL(route.request().url()).pathname.split('/min/')[1]
		if (asset === blockedAsset) return route.abort()
		return route.fulfill({ path: path.resolve('node_modules/monaco-editor/min', asset), headers: { 'access-control-allow-origin': '*' } })
	})
}
