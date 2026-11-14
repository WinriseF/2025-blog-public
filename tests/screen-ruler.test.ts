import { describe, expect, it } from 'vitest'
import {
	calibrationMatches,
	calibrationScale,
	compareCardSamples,
	fitRulerCalibration,
	lengthLabel,
	parseCalibration,
	rulerTicks,
	type RulerCalibration
} from '../src/lib/screen-ruler'

describe('physical screen ruler', () => {
	it('keeps the same physical tick positions at different viewport lengths', () => {
		const scale = calibrationScale(428, 85.6)!
		expect(scale).toBe(5)
		const small = rulerTicks(500, scale, 'cm')
		const large = rulerTicks(1000, scale, 'cm')
		expect(small[100].pixel).toBe(500)
		expect(large.slice(0, small.length)).toEqual(small)
		// Independently placed ticks must not accumulate rounding error.
		expect(rulerTicks(1000, 3.713, 'cm')[200].pixel).toBeCloseTo(742.6)
	})
	it('converts inches without changing physical distance', () => {
		expect(lengthLabel(25.4, 'in')).toBe('1.000')
		expect(lengthLabel(25.4, 'cm')).toBe('2.54')
		expect(rulerTicks(200, 5, 'in')[16].pixel).toBe(127)
	})
	it('fits noisy multi-length measurements and exposes inconsistent readings', () => {
		const fit = fitRulerCalibration([
			{ pixels: 100, mm: 20.1 },
			{ pixels: 250, mm: 49.9 },
			{ pixels: 450, mm: 90.1 }
		])!
		expect(fit.pxPerMm).toBeCloseTo(5, 1)
		expect(fit.residualMm).toBeLessThan(0.11)
		const bad = fitRulerCalibration([
			{ pixels: 100, mm: 20 },
			{ pixels: 250, mm: 70 },
			{ pixels: 450, mm: 90 }
		])!
		expect(bad.residualMm).toBeGreaterThan(1)
		expect(fitRulerCalibration([{ pixels: 100, mm: 0 }])).toBeNull()
	})
	it('allows up to 2% repeated alignment difference', () => {
		expect(compareCardSamples(428, 429)).toBe(true)
		expect(compareCardSamples(428, 434)).toBe(true)
		expect(compareCardSamples(99, 101)).toBe(true)
		expect(compareCardSamples(99, 101.01)).toBe(false)
		expect(compareCardSamples(428, 440)).toBe(false)
	})
	it('restores custom calibration without inventing an independent check result', () => {
		const value: RulerCalibration = { version: 2, pxPerMm: 4, method: 'custom', checkErrorMm: null, dpr: 2, width: 390, height: 844 }
		expect(parseCalibration(JSON.stringify(value))).toEqual(value)
		expect(parseCalibration(JSON.stringify({ ...value, method: 'card' }))).toBeNull()
	})
	it('rejects stale or corrupt saved calibration and detects scale changes', () => {
		const value: RulerCalibration = { version: 2, pxPerMm: 5, method: 'ruler', checkErrorMm: 0.2, dpr: 2, width: 900, height: 1440 }
		expect(parseCalibration(JSON.stringify(value))).toEqual(value)
		expect(parseCalibration('{bad')).toBeNull()
		expect(parseCalibration(JSON.stringify({ ...value, pxPerMm: -1 }))).toBeNull()
		expect(parseCalibration(JSON.stringify({ ...value, version: 1 }))).toBeNull()
		expect(calibrationMatches(value, { width: 900, height: 1440, dpr: 2 })).toBe(true)
		expect(calibrationMatches(value, { width: 900, height: 1440, dpr: 2.5 })).toBe(false)
		expect(calibrationMatches(value, { width: 1080, height: 1920, dpr: 2 })).toBe(false)
	})
})
