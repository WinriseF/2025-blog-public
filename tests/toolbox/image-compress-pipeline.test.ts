import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidatePlan, ImageAnalysis, ImageCompressionPreset } from '../../src/lib/image-compress/types'

const state = vi.hoisted(() => ({
	passQuality: true,
	minimumPassingColors: 0,
	failQuantization: false,
	noMeaningfulGain: false,
	losslessSize: 20_000,
	optimise: vi.fn(async (_source: ArrayBuffer, _options: Record<string, unknown>) => {
		const bytes = new Uint8Array(state.losslessSize)
		bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		return bytes.buffer
	}),
	metadata: { orientation: 1, hasGps: false, hasIcc: false, wideGamut: false, colorUncertain: false, warning: null as string | null },
	analysis: {
		alphaCoverage: 0, semiTransparent: 0, coarseColors: 1000, flatAreaRatio: 0.1,
		edgeDensity: 0.05, hvEdgeRatio: 0.2, lumaEntropy: 5.8, noiseScore: 0.02, gradientRatio: 0.1
	} as ImageAnalysis,
	classification: 'mixed' as const,
	encodeCandidate: vi.fn(async (plan: CandidatePlan) => {
		const quantization = plan.quantization
		if (quantization && state.failQuantization) throw new Error('libimagequant failed')
		const size = state.noMeaningfulGain
			? quantization ? 19_500 + quantization.maxColors * 10 + Math.round(quantization.dithering * 100) : 19_900
			: quantization ? 1_500 + quantization.maxColors * 10 + Math.round(quantization.dithering * 100) : 6_000
		return {
			format: plan.format,
			bytes: new ArrayBuffer(size),
			encoder: quantization ? `libimagequant ${quantization.maxColors} colors → OxiPNG` : 'unsupported',
			preview: new ImageData(new Uint8ClampedArray([quantization?.maxColors ?? 255, 0, 0, 255]), 1, 1),
			paletteColors: quantization?.maxColors,
			quantization
		}
	})
}))

vi.mock('../../src/lib/image-compress/cdn', async importOriginal => ({
	...await importOriginal<typeof import('../../src/lib/image-compress/cdn')>(),
	loadOxiPng: vi.fn(async () => ({ optimise: state.optimise }))
}))

vi.mock('../../src/lib/image-compress/metadata', () => ({
	inspectImageMetadata: vi.fn(async () => state.metadata)
}))

vi.mock('../../src/lib/image-compress/decode', () => ({
	NativeWorkerDecodeUnavailable: class extends Error {},
	decodeImageInWorker: vi.fn(async () => ({ image: new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1), warnings: [] })),
	decodeEncodedCandidate: vi.fn(),
	resizeQualityPreview: vi.fn(),
	flattenAlpha: vi.fn((image: ImageData) => image)
}))

vi.mock('../../src/lib/image-compress/features', () => ({
	analyzeImage: vi.fn(() => state.analysis),
	classifyImage: vi.fn(() => state.classification),
	sampleImageData: vi.fn((image: ImageData) => image)
}))

vi.mock('../../src/lib/image-compress/encode', () => ({ encodeCandidate: state.encodeCandidate }))

vi.mock('../../src/lib/image-compress/quality', () => ({
	compareImageQuality: vi.fn((_reference: ImageData, candidate: ImageData) => ({ ssim: candidate.data[0] >= state.minimumPassingColors ? 0.97 : 0.9, edgeError: 0.05, alphaMae: 0 })),
	passesQualityGate: vi.fn(metrics => state.passQuality && metrics.ssim >= 0.96)
}))

import { compressImage } from '../../src/lib/image-compress/pipeline'
import { decodeImageInWorker, NativeWorkerDecodeUnavailable } from '../../src/lib/image-compress/decode'

function sourcePng() {
	const bytes = new Uint8Array(20_000)
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	const view = new DataView(bytes.buffer)
	view.setUint32(16, 1)
	view.setUint32(20, 1)
	return new File([bytes], 'office.png', { type: 'image/png' })
}

async function run(output: 'keep' | 'png' = 'keep', preset: ImageCompressionPreset = 'smaller', stripMetadata = false) {
	return compressImage({
		file: sourcePng(),
		options: { preset, output, compatibility: 'compatible', stripMetadata, jpegBackground: '#ffffff' },
		limits: { lowMemory: true },
		onProgress: () => {}
	})
}

describe('PNG candidate selection', () => {
	beforeEach(() => {
		vi.stubGlobal('ImageData', class {
			constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
		})
		state.passQuality = true
		state.minimumPassingColors = 0
		state.failQuantization = false
		state.noMeaningfulGain = false
		state.losslessSize = 20_000
		state.optimise.mockClear()
		state.metadata = { orientation: 1, hasGps: false, hasIcc: false, wideGamut: false, colorUncertain: false, warning: null }
		state.analysis = { ...state.analysis, alphaCoverage: 0, gradientRatio: 0.1 }
		state.encodeCandidate.mockClear()
	})

	afterEach(() => vi.unstubAllGlobals())

	it('evaluates 128/64/32/16-color candidates and selects the smallest passing bytes', async () => {
		const result = await run()
		const palettes = state.encodeCandidate.mock.calls.map(([plan]) => plan.quantization?.maxColors).filter(Boolean)
		expect(palettes).toEqual([128, 128, 64, 64, 32, 32, 16, 16])
		expect(result).toMatchObject({ usedOriginal: false, outputBytes: 1_665, encoder: 'libimagequant 16 colors → OxiPNG' })
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ reason: 'quantized-selected', paletteColors: 16, targetQuality: 50, dithering: 0.05 }))
		expect(result.diagnostics.find(item => item.reason === 'quantized-selected')?.metrics).toEqual({ ssim: 0.97, edgeError: 0.05, alphaMae: 0 })
	})

	it.each([[128, 2_785], [64, 2_145], [32, 1_825], [16, 1_665]] as const)('selects the smallest passing candidate when the gate requires at least %i colors', async (minimumColors, outputBytes) => {
		state.minimumPassingColors = minimumColors
		const result = await run()
		expect(result).toMatchObject({ usedOriginal: false, outputBytes })
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ reason: 'quantized-selected', paletteColors: minimumColors }))
	})

	it('falls back to the original when every encoded candidate fails the quality gate', async () => {
		state.passQuality = false
		const result = await run('png')
		expect(result.usedOriginal).toBe(true)
		expect(result.outputBytes).toBe(20_000)
		expect(result.diagnostics.filter(item => item.reason === 'quality-rejected')).toHaveLength(8)
		expect(result.warnings.join(' ')).toContain('质量门禁')
	})

	it('fails instead of switching encoders when PNG quantization fails', async () => {
		state.failQuantization = true
		await expect(run()).rejects.toMatchObject({ code: 'ENCODE_FAILED', message: expect.stringContaining('libimagequant failed') })
		expect(state.optimise).not.toHaveBeenCalled()
	})

	it('optimizes original bytes after quality rejection without treating lossless pixels as rejected', async () => {
		state.passQuality = false
		state.losslessSize = 16_000
		const result = await run('png', 'smart')
		expect(result).toMatchObject({ usedOriginal: false, outputBytes: 16_000, encoder: 'OxiPNG 原图无损优化' })
		expect(new Uint8Array(state.optimise.mock.lastCall![0])).toEqual(new Uint8Array(await sourcePng().arrayBuffer()))
	})

	it('skips original optimization when the fast palette already saves substantially', async () => {
		await run('keep', 'smart')
		expect(state.encodeCandidate).toHaveBeenCalledTimes(1)
		expect(state.optimise).not.toHaveBeenCalled()
	})

	it('does not reuse source metadata when metadata removal is requested', async () => {
		state.passQuality = false
		await expect(run('png', 'smart', true)).rejects.toMatchObject({ code: 'QUALITY_GATE_FAILED' })
		expect(state.optimise).not.toHaveBeenCalled()
	})

	it('preserves the signal requesting main-thread compatibility decode', async () => {
		const error = new NativeWorkerDecodeUnavailable('compatibility decode')
		vi.mocked(decodeImageInWorker).mockRejectedValueOnce(error)
		await expect(run()).rejects.toBe(error)
		expect(state.encodeCandidate).not.toHaveBeenCalled()
	})

	it('classifies a decoder network failure without masking the original error', async () => {
		vi.mocked(decodeImageInWorker).mockRejectedValueOnce(new Error('Failed to fetch decoder'))
		await expect(run()).rejects.toMatchObject({ code: 'CDN_UNAVAILABLE', message: expect.stringContaining('Failed to fetch decoder') })
	})

	it('records no meaningful gain before preserving the original PNG', async () => {
		state.noMeaningfulGain = true
		const result = await run()
		expect(result.usedOriginal).toBe(true)
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ reason: 'no-meaningful-gain', finalBytes: 20_000 }))
	})

	it.each([
		['icc-uncertain', { hasIcc: true, wideGamut: false, colorUncertain: true }],
		['wide-gamut', { hasIcc: true, wideGamut: true, colorUncertain: false }]
	] as const)('records %s color fallback without starting encoders', async (reason, color) => {
		state.metadata = { ...state.metadata, ...color }
		const result = await run()
		expect(result.usedOriginal).toBe(true)
		expect(result.diagnostics).toEqual([expect.objectContaining({ reason, originalBytes: 20_000, finalBytes: 20_000 })])
		expect(state.encodeCandidate).not.toHaveBeenCalled()
	})
})
