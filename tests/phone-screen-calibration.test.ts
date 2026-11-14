import { describe, expect, it } from 'vitest'
import { estimatePhoneScreen, phoneScreenDimensions, type PhoneScreenEnvironment } from '../src/lib/phone-screen-calibration'
import { rulerReferences } from '../src/lib/ruler-references'
import { calibrationMatches, parseCalibration, type RulerCalibration } from '../src/lib/screen-ruler'

const environment: PhoneScreenEnvironment = { width: 390, height: 844, dpr: 3, mobile: true, viewportWidth: 390, screenWidth: 390, pinchScale: 1 }
const iphone = rulerReferences.find(r => r.id === 'apple-iphone-14')!.screens![0]

describe('current-phone scale estimation', () => {
	it('uses the full CSS screen and published diagonal, independently of render DPR', () => {
		const estimate = estimatePhoneScreen(iphone, environment)
		expect(estimate.pxPerMm).toBeCloseTo(Math.hypot(390, 844) / (6.06 * 25.4), 8)
		expect(estimatePhoneScreen(iphone, { ...environment, dpr: 2 }).pxPerMm).toBe(estimate.pxPerMm)
		expect(estimatePhoneScreen(iphone, { ...environment, viewportWidth: 844, screenWidth: 844 }).pxPerMm).toBe(estimate.pxPerMm)
		const samsung = rulerReferences.find(r => r.name === 'Galaxy S25 Ultra')!.screens![0]
		expect(phoneScreenDimensions(samsung)!.diagonalMm).toBe(174.2)
	})
	it('blocks desktop, mismatching screens, page scaling, incomplete specs and special pixel definitions', () => {
		for (const override of [{ mobile: false }, { width: 768, height: 1024 }, { pinchScale: 1.5 }, { viewportWidth: 980 }]) {
			expect(estimatePhoneScreen(iphone, { ...environment, ...override }).error).toBeTruthy()
		}
		expect(phoneScreenDimensions({ ...iphone, resolutionWidthPx: undefined })).toBeNull()
		expect(phoneScreenDimensions({ ...iphone, resolutionBasis: 'super-pixel' })).toBeNull()
		expect(phoneScreenDimensions({ ...iphone, kind: 'rear' })).toBeNull()
		expect(phoneScreenDimensions({ ...iphone, diagonalInches: undefined, ppi: 460 })).toBeNull()
	})
	it('distinguishes foldable screens and restores an estimate without inventing a measured error', () => {
		const fold = rulerReferences.find(r => r.name === 'Galaxy Z Fold5')!
		const inner = fold.screens!.find(s => s.kind === 'inner')!,
			cover = fold.screens!.find(s => s.kind === 'cover')!
		const outerEnvironment = { ...environment, width: 452, height: 1158, viewportWidth: 452, screenWidth: 452 }
		expect(estimatePhoneScreen(cover, outerEnvironment).pxPerMm).toBeGreaterThan(0)
		expect(estimatePhoneScreen(inner, outerEnvironment).error).toBeTruthy()
		const calibration: RulerCalibration = {
			version: 2,
			method: 'device',
			pxPerMm: 6,
			checkErrorMm: null,
			referenceId: 'apple-iphone-14',
			referenceName: 'iPhone 14',
			screenKind: 'main',
			width: 390,
			height: 844,
			dpr: 3
		}
		expect(parseCalibration(JSON.stringify(calibration))).toEqual(calibration)
		expect(parseCalibration(JSON.stringify({ ...calibration, referenceId: undefined }))).toBeNull()
		expect(parseCalibration(JSON.stringify({ ...calibration, screenKind: 'rear' }))).toBeNull()
		expect(parseCalibration(JSON.stringify({ ...calibration, checkErrorMm: 0 }))).toBeNull()
		expect(calibrationMatches(calibration, { width: 390, height: 844, dpr: 3 })).toBe(true)
		expect(calibrationMatches(calibration, { width: 390, height: 844, dpr: 2 })).toBe(false)
		expect(calibrationMatches(calibration, { width: 768, height: 844, dpr: 3 })).toBe(false)
	})
})
