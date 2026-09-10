import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareImageQuality } from '../../src/lib/image-compress/quality'

afterEach(() => vi.unstubAllGlobals())

describe('image quality metrics', () => {
	it('ignores invisible RGB changes while still comparing alpha', () => {
		vi.stubGlobal('ImageData', class {
			constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
		})
		const reference = new ImageData(new Uint8ClampedArray([255, 0, 0, 0, 20, 40, 60, 255]), 2, 1)
		const hiddenRgbChanged = new ImageData(new Uint8ClampedArray([0, 255, 255, 0, 20, 40, 60, 255]), 2, 1)
		const alphaChanged = new ImageData(new Uint8ClampedArray([0, 255, 255, 32, 20, 40, 60, 255]), 2, 1)
		expect(compareImageQuality(reference, hiddenRgbChanged)).toEqual({ ssim: 1, edgeError: 0, alphaMae: 0 })
		expect(compareImageQuality(reference, alphaChanged).alphaMae).toBeGreaterThan(0)
	})
})
