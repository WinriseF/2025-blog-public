import { describe, expect, it } from 'vitest'
import { isPageKey, pageKeyForPath } from '../../supabase/functions/_shared/page-key'

describe('page view keys', () => {
	it.each([
		['/', '/'], ['/toolbox/zip/', '/toolbox/zip'], ['/blog/db2026', '/blog/db2026'],
		['/news/2026-11-19', '/news/2026-11-19'], ['/news/english-reading/a.b', '/news/english-reading/a.b'],
		['/t/ABCD23', '/t/[code]'], ['/t/STATUS', '/t/[code]'], ['/t/lan/1234abcd', '/t/lan/[roomId]']
	])('groups %s as %s', (path, key) => {
		expect(pageKeyForPath(path)).toBe(key)
		expect(isPageKey(key)).toBe(true)
	})

	it.each(['/t/status', '/t/native-agent-return', '/toolbox/version-control/agent-return', '/api/test', '/unknown', '/images/logo.png'])('skips %s', path => {
		expect(pageKeyForPath(path)).toBeNull()
		expect(isPageKey(path)).toBe(false)
	})

	it.each(['/t/ABCD23', '/t/lan/1234abcd', '/toolbox/zip?file=private', '/blog/foo#anchor'])('rejects raw or noncanonical key %s at intake', key => {
		expect(isPageKey(key)).toBe(false)
	})
})
