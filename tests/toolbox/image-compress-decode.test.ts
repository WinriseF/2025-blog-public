import { afterEach, describe, expect, it, vi } from 'vitest'
import { flattenAlpha } from '../../src/lib/image-compress/decode'

afterEach(() => vi.unstubAllGlobals())

describe('image compression pixels', () => {
	it('preserves zero channels when flattening transparency onto red or black', () => {
		vi.stubGlobal('ImageData', class {
			constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
		})
		const input = new ImageData(new Uint8ClampedArray([30, 60, 90, 0, 30, 60, 90, 255]), 2, 1)
		expect([...flattenAlpha(input, '#ff0000').data]).toEqual([255, 0, 0, 255, 30, 60, 90, 255])
		expect([...flattenAlpha(input, '#000000').data]).toEqual([0, 0, 0, 255, 30, 60, 90, 255])
	})
})
