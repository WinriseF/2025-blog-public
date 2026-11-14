import { describe, expect, it } from 'vitest'
import { searchReferences, referenceBrands, referenceLengths, rulerReferences } from '../src/lib/ruler-references'
import { parseCalibration } from '../src/lib/screen-ruler'

describe('official ruler reference catalog', () => {
	it('keeps traceable, distinct records for every requested brand', () => {
		expect(new Set(rulerReferences.map(item => item.id)).size).toBe(rulerReferences.length)
		for (const brand of referenceBrands) expect(rulerReferences.some(item => item.brand === brand.id)).toBe(true)
		const officialDomains = [
			'apple.com',
			'mi.com',
			'vivo.com.cn',
			'vivo.com',
			'consumer.huawei.com',
			'oppo.com',
			'samsungmobilepress.com',
			'honor.com',
			'support.motorola.com',
			'lenovo.com.cn'
		]
		for (const item of rulerReferences.filter(item => item.category === 'phone')) {
			expect(item.heightMm).toBeGreaterThan(65)
			expect(item.heightMm).toBeLessThan(190)
			expect(item.widthMm).toBeGreaterThan(50)
			expect(item.widthMm).toBeLessThan(100)
			expect(item.sources.length).toBeGreaterThan(0)
			for (const source of item.sources) {
				const url = new URL(source)
				expect(url.protocol).toBe('https:')
				expect(officialDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))).toBe(true)
			}
		}
	})
	it('uses each document’s actual nominal size, not a universal bank-card size', () => {
		const china = rulerReferences.find(item => item.id === 'id-cn')!
		const korea = rulerReferences.find(item => item.id === 'id-kr')!
		expect(referenceLengths(china, 'width')).toEqual([85.6, 85.6, 54])
		expect(referenceLengths(korea, 'width')).toEqual([86, 86, 54])
		expect(
			referenceLengths(
				rulerReferences.find(item => item.id === 'bank-card-id1')!,
				'width'
			)
		).toEqual([85.6, 85.6, 53.98])
	})
	it('keeps screen specifications traceable and distinct from body measurements', () => {
		const screenDomains = [
			'apple.com',
			'mi.com',
			'vivo.com',
			'vivo.com.cn',
			'huawei.com',
			'oppo.com',
			'samsung.com',
			'samsungmobilepress.com',
			'honor.com',
			'motorola.com',
			'lenovo.com.cn'
		]
		for (const reference of rulerReferences) {
			if (reference.category !== 'phone') {
				expect(reference.screens).toBeUndefined()
				continue
			}
			expect(reference.screens?.length).toBeGreaterThan(0)
			expect(new Set(reference.screens!.map(screen => screen.kind)).size).toBe(reference.screens!.length)
			for (const screen of reference.screens!) {
				expect(screen.sourceType).toBe('official')
				expect(screen.sources.length).toBeGreaterThan(0)
				for (const source of screen.sources) {
					const url = new URL(source)
					expect(url.protocol).toBe('https:')
					expect(screenDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))).toBe(true)
				}
				expect(screen.resolutionWidthPx === undefined).toBe(screen.resolutionHeightPx === undefined)
				if (screen.resolutionWidthPx !== undefined) {
					expect(Number.isInteger(screen.resolutionWidthPx)).toBe(true)
					expect(Number.isInteger(screen.resolutionHeightPx)).toBe(true)
					expect(screen.resolutionWidthPx).toBeGreaterThan(0)
					expect(screen.resolutionHeightPx).toBeGreaterThanOrEqual(screen.resolutionWidthPx)
				}
				if (screen.diagonalInches !== undefined) {
					expect(screen.diagonalInches).toBeGreaterThan(1)
					expect(screen.diagonalInches).toBeLessThan(12)
					expect(['rectangle', 'unspecified']).toContain(screen.diagonalBasis)
				}
				if (screen.ppi && screen.diagonalInches && screen.resolutionWidthPx && screen.resolutionHeightPx) {
					// Detect mismatched inner/cover values; this is not a ruler accuracy guarantee.
					const calculated = Math.hypot(screen.resolutionWidthPx, screen.resolutionHeightPx) / screen.diagonalInches
					expect(Math.abs(calculated / screen.ppi - 1)).toBeLessThan(0.03)
				}
			}
		}
	})
	it('preserves precise official diagonals, incomplete records, and separate foldable screens', () => {
		const iphone = rulerReferences.find(item => item.id === 'apple-iphone-14')!
		expect(iphone.screens![0]).toMatchObject({ diagonalInches: 6.06, diagonalBasis: 'rectangle', resolutionWidthPx: 1170, resolutionHeightPx: 2532, ppi: 460 })
		expect(referenceLengths(iphone, 'width')).toEqual([71.5, 71.5, 71.5])
		const samsung = rulerReferences.find(item => item.name === 'Galaxy S25 Ultra')!
		expect(samsung.screens![0]).toMatchObject({ diagonalInches: 6.9, diagonalMm: 174.2, resolutionWidthPx: 1440, resolutionHeightPx: 3120 })
		const fold = rulerReferences.find(item => item.name === 'Galaxy Z TriFold')!
		expect(fold.screens!.map(screen => [screen.kind, screen.diagonalInches])).toEqual([
			['inner', 10],
			['cover', 6.5]
		])
		const circular = rulerReferences.find(item => item.name === 'HUAWEI Pocket 2 优享版')!.screens!.find(screen => screen.kind === 'cover')!
		expect(circular.diagonalInches).toBeUndefined()
		expect(circular).toMatchObject({ resolutionWidthPx: 340, resolutionHeightPx: 340, ppi: 296 })
		expect(circular.note).toContain('圆形')
		const incomplete = rulerReferences.find(item => item.name === 'GALAXY A5')!.screens![0]
		expect(incomplete.diagonalInches).toBe(5)
		expect(incomplete.resolutionWidthPx).toBeUndefined()
		expect(incomplete.note).toContain('未提供')
		const superPixel = rulerReferences.find(item => item.name === 'Xiaomi 17 Pro Max')!.screens!.find(screen => screen.kind === 'main')!
		expect(superPixel.resolutionBasis).toBe('super-pixel')
	})
	it('uses phone body width or height for all three independent alignments', () => {
		const phone = rulerReferences.find(item => item.id === 'apple-iphone-14')!
		expect(referenceLengths(phone, 'width')).toEqual([71.5, 71.5, 71.5])
		expect(referenceLengths(phone, 'height')).toEqual([146.7, 146.7, 146.7])
		const folded = rulerReferences.find(item => item.name === 'HUAWEI Pura X')!
		expect(folded.region).toContain('折叠状态')
		expect([folded.heightMm, folded.widthMm]).toEqual([91.7, 74.3])
	})
	it('ignores case and tolerates spelling mistakes without changing model numbers', () => {
		const ids = (query: string) => searchReferences(query).references.map(item => item.id)
		expect(ids('redmi')).toEqual(ids('REDMI'))
		expect(ids('redmi')).toEqual(ids('Redmi'))
		expect(ids('redme')).toEqual(ids('REDME'))
		expect(searchReferences('redme').references.length).toBeGreaterThan(0)
		expect(searchReferences('redme').references[0].name).toMatch(/^redmi/i)
		expect(searchReferences('redmi').references.every(item => /^redmi/i.test(item.name))).toBe(true)
		expect(ids('iphne 14')).toContain('apple-iphone-14')
		expect(ids('IPHNE 14')).toEqual(ids('iphne 14'))
		expect(ids('iphne 14')).not.toContain('apple-iphone-15')
		expect(ids('苹果 iphone14')).toContain('apple-iphone-14')
		expect(ids('ｉＰＨＯＮＥ１４')).toEqual(ids('iphone14'))
		expect(ids('德国')).toContain('id-de')
		expect(ids('qqqzzzzxxxx')).toEqual([])
		expect(searchReferences('RULER').showRuler).toBe(true)
		expect(searchReferences('rulr').showRuler).toBe(true)
		expect(searchReferences('纸张').showCustom).toBe(true)
		expect(searchReferences('CUSTOM').showCustom).toBe(true)
		expect(searchReferences('纸张').showRuler).toBe(false)
		expect(searchReferences('ruler').showCustom).toBe(false)
		expect(ids('')).toEqual(rulerReferences.map(item => item.id))
	})
	it('finds USB plugs and calibrates using their width rather than the tiny height', () => {
		for (const [query, id, width] of [
			['U盘', 'usb-a-plug', 12],
			['TYPE C', 'usb-c-plug', 8.25]
		] as const) {
			const plug = searchReferences(query).references.find(item => item.id === id)!
			expect(plug).toBeDefined()
			expect(referenceLengths(plug, 'width')).toEqual([width, width, width])
			expect(plug.note).toContain('可能不够准确')
			const calibration = { version: 2, pxPerMm: 4, dpr: 2, width: 390, height: 844, method: 'connector', checkErrorMm: 0, referenceId: id }
			expect(parseCalibration(JSON.stringify(calibration))).toEqual(calibration)
		}
	})
	it('finds SD and TF cards with distinct long and short sides', () => {
		for (const [query, id, lengths] of [
			['SD', 'memory-sd', [32, 32, 24]],
			['tf', 'memory-microsd', [15, 15, 11]]
		] as const) {
			const reference = searchReferences(query).references.find(item => item.id === id)!
			expect(reference.category).toBe('memory')
			expect(referenceLengths(reference, 'width')).toEqual(lengths)
			expect(reference.sources[0]).toContain('sdcard.org')
		}
		expect(searchReferences('MICROSD').references.some(item => item.id === 'memory-microsd')).toBe(true)
	})
	it('persists the selected phone reference alongside the calibrated scale', () => {
		const calibration = { version: 2, pxPerMm: 4, dpr: 2, width: 390, height: 844, method: 'phone', checkErrorMm: 0.1, referenceId: 'apple-iphone-14' }
		expect(parseCalibration(JSON.stringify(calibration))).toEqual(calibration)
	})
})
