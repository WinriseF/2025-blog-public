import { describe, expect, it } from 'vitest'
import { nextCandidate } from '../../src/lib/image-compress/search'
import type { CandidatePlan } from '../../src/lib/image-compress/types'

const good = { passed: true, metrics: { ssim: 0.998, edgeError: 0.01, alphaMae: 0 } }
const jpeg: CandidatePlan = { format: 'jpeg', variant: 'lossy', jpegDistance: 3.5 }
const png: CandidatePlan = { format: 'png', variant: 'quantized', quantization: { maxColors: 256, minQuality: 0, targetQuality: 80, dithering: 0.4, speed: 3 } }

describe('bounded adaptive image search', () => {
	it('spends one JPEG retry on quality after rejection, then stops', () => {
		const rejected = { ...good, passed: false }
		const retry = nextCandidate(jpeg, rejected, 'photo', 'smart', false)!
		expect(retry.jpegDistance).toBe(1.5)
		expect(nextCandidate(retry, good, 'photo', 'smart', true)).toBeNull()
	})

	it('tries a smaller JPEG only with quality headroom and substantial savings', () => {
		const retry = nextCandidate(jpeg, good, 'photo', 'smart', true)!
		expect(retry.jpegDistance).toBe(6)
		expect(nextCandidate(retry, good, 'photo', 'smart', true)).toBeNull()
		expect(nextCandidate(jpeg, good, 'photo', 'smart', false)).toBeNull()
	})

	it('tries just one smaller palette and protects text and transparent edges', () => {
		const retry = nextCandidate(png, good, 'ui-text', 'smart', true)!
		expect(retry.quantization?.maxColors).toBe(128)
		expect(nextCandidate(retry, good, 'ui-text', 'smart', true)).toBeNull()
		for (const metrics of [{ ...good.metrics, edgeError: 0.02 }, { ...good.metrics, alphaMae: 0.003 }, { ...good.metrics, ssim: 0.99 }]) {
			expect(nextCandidate(png, { passed: true, metrics }, 'ui-text', 'smart', true)).toBeNull()
		}
	})

	it('does not extend the exhaustive smaller search or higher-quality PNG search', () => {
		expect(nextCandidate(png, good, 'photo', 'smaller', true)).toBeNull()
		expect(nextCandidate(png, good, 'photo', 'higher', true)).toBeNull()
	})
})
