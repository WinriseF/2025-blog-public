import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const codecs = vi.hoisted(() => ({
	jpegli: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
	jxl: vi.fn(async () => new Uint8Array([0xff, 0x0a]).buffer),
	optimise: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer),
	quantize: vi.fn(async (image: ImageData) => ({
		bytes: new ArrayBuffer(16),
		imageData: image,
		paletteLength: 16
	}))
}))

vi.mock('../../src/lib/image-compress/cdn', () => ({
	loadOxiPng: vi.fn(async () => ({ optimise: codecs.optimise })),
	quantizeImage: codecs.quantize,
	loadJpegliEncoder: vi.fn(async () => ({ encode: codecs.jpegli })),
	loadWebpEncoder: vi.fn(),
	loadAvifEncoder: vi.fn(),
	loadJxlCodec: vi.fn(async () => ({ encode: codecs.jxl }))
}))

import { encodeCandidate } from '../../src/lib/image-compress/encode'

const analysis = {
	alphaCoverage: 0.5, semiTransparent: 0, coarseColors: 16, flatAreaRatio: 0.9,
	edgeDensity: 0.2, hvEdgeRatio: 0.8, lumaEntropy: 2, noiseScore: 0, gradientRatio: 0
}
const options = { preset: 'smaller' as const, output: 'keep' as const, compatibility: 'compatible' as const, stripMetadata: false, jpegBackground: '#ffffff' }

describe('image candidate encoding', () => {
	beforeEach(() => {
		vi.stubGlobal('ImageData', class {
			constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
		})
	})

	afterEach(() => vi.unstubAllGlobals())

	it('passes each palette target and dithering choice through libimagequant', async () => {
		const image = new ImageData(new Uint8ClampedArray([20, 40, 60, 255]), 1, 1)
		const quantization = { maxColors: 16, targetQuality: 45, minQuality: 0, dithering: 0, speed: 3 }
		const result = await encodeCandidate({ format: 'png', variant: 'quantized', quantization }, image, analysis, 'flat-illustration', options)
		expect(codecs.quantize).toHaveBeenLastCalledWith(image, quantization)
		expect(codecs.optimise).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), { level: 4, interlace: false, optimiseAlpha: false })
		expect(result).toMatchObject({ paletteColors: 16, quantization })
	})

	it('does not expose a truecolor PNG encoder path', async () => {
		const image = new ImageData(new Uint8ClampedArray([20, 40, 60, 255]), 1, 1)
		await expect(encodeCandidate({ format: 'png', variant: 'lossless' }, image, analysis, 'mixed', options)).rejects.toThrow('没有为 png 配置编码器')
	})

	it('uses JPEGli and libjxl as the only JPEG-family encoders', async () => {
		const image = new ImageData(new Uint8ClampedArray([20, 40, 60, 255]), 1, 1)
		const jpeg = await encodeCandidate({ format: 'jpeg', variant: 'lossy', jpegDistance: 4 }, image, { ...analysis, alphaCoverage: 0 }, 'photo', options)
		const jxl = await encodeCandidate({ format: 'jxl', variant: 'lossy' }, image, analysis, 'photo', options)
		expect(jpeg.encoder).toBe('JPEGli')
		expect(codecs.jpegli).toHaveBeenCalledWith(image, expect.objectContaining({ distance: 4, chromaSubsampling: '420' }))
		expect(jxl.encoder).toBe('libjxl')
		expect(codecs.jxl).toHaveBeenCalledWith(image, expect.objectContaining({ quality: 68, effort: 8 }))
	})
})
