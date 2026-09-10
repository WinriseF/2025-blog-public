import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const codecs = vi.hoisted(() => ({
	optimise: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer),
	pngEncode: vi.fn(async () => new ArrayBuffer(16)),
	quantize: vi.fn(async (image: ImageData) => ({
		bytes: new ArrayBuffer(16),
		imageData: image,
		paletteLength: 16
	}))
}))

vi.mock('../../src/lib/image-compress/cdn', () => ({
	loadPngEncoder: vi.fn(async () => ({ encode: codecs.pngEncode })),
	loadOxiPng: vi.fn(async () => ({ optimise: codecs.optimise })),
	quantizeImage: codecs.quantize,
	loadJpegEncoder: vi.fn(),
	loadWebpEncoder: vi.fn(),
	loadAvifEncoder: vi.fn()
}))

import { encodeCandidate } from '../../src/lib/image-compress/encode'

const analysis = {
	alphaCoverage: 0.5, semiTransparent: 0, coarseColors: 16, flatAreaRatio: 0.9,
	edgeDensity: 0.2, hvEdgeRatio: 0.8, lumaEntropy: 2, noiseScore: 0, gradientRatio: 0
}
const options = { preset: 'smaller' as const, output: 'keep' as const, compatibility: 'compatible' as const, stripMetadata: false, jpegBackground: '#ffffff' }

describe('PNG candidate encoding', () => {
	beforeEach(() => {
		vi.stubGlobal('ImageData', class {
			constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
		})
	})

	afterEach(() => vi.unstubAllGlobals())

	it('enables OxiPNG transparent-RGB optimization only on its explicit lossless candidate', async () => {
		const image = new ImageData(new Uint8ClampedArray([20, 40, 60, 0]), 1, 1)
		await encodeCandidate({ format: 'png', variant: 'lossless', optimiseAlpha: true }, image, analysis, 'transparent-icon', options)
		expect(codecs.optimise).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), { level: 4, interlace: false, optimiseAlpha: true })

		await encodeCandidate({ format: 'png', variant: 'lossless' }, image, analysis, 'transparent-icon', options)
		expect(codecs.optimise).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), { level: 4, interlace: false, optimiseAlpha: false })
	})

	it('passes each palette target and dithering choice through libimagequant', async () => {
		const image = new ImageData(new Uint8ClampedArray([20, 40, 60, 255]), 1, 1)
		const quantization = { maxColors: 16, targetQuality: 45, minQuality: 0, dithering: 0, speed: 3 }
		const result = await encodeCandidate({ format: 'png', variant: 'quantized', quantization }, image, analysis, 'flat-illustration', options)
		expect(codecs.quantize).toHaveBeenLastCalledWith(image, quantization)
		expect(codecs.optimise).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), { level: 4, interlace: false, optimiseAlpha: false })
		expect(result).toMatchObject({ paletteColors: 16, quantization })
	})
})
