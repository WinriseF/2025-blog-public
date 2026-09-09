import { describe, expect, it } from 'vitest'
import { classifyImage } from '../../src/lib/image-compress/features'
import { buildCandidatePlans, computeTargetSize, jpegOptions } from '../../src/lib/image-compress/presets'
import type { ImageAnalysis, ImageCompressionOptions } from '../../src/lib/image-compress/types'

const analysis: ImageAnalysis = {
	alphaCoverage: 0,
	semiTransparent: 0,
	coarseColors: 1000,
	flatAreaRatio: 0.1,
	edgeDensity: 0.05,
	hvEdgeRatio: 0.2,
	lumaEntropy: 5.8,
	noiseScore: 0.02,
	gradientRatio: 0.1
}

const options: ImageCompressionOptions = {
	preset: 'smart',
	output: 'auto',
	compatibility: 'compatible',
	stripMetadata: false,
	jpegBackground: '#ffffff'
}

describe('image compression strategy', () => {
	it('tries PNG quantization even for gradients and complex transparency', () => {
		for (const output of ['keep', 'png', 'auto'] as const) {
			const plans = buildCandidatePlans({ sourceFormat: 'png', classification: 'mixed', analysis: { ...analysis, gradientRatio: 0.8, semiTransparent: 0.6, alphaCoverage: 0.6 }, options: { ...options, output }, sourceBytes: 2_000_000, pixels: 2_000_000 })
			expect(plans).toContainEqual({ format: 'png', variant: 'quantized' })
			expect(plans).toContainEqual({ format: 'png', variant: 'lossless' })
		}
	})

	it('applies the pixel budget without changing aspect ratio', () => {
		expect(computeTargetSize(8000, 6000, 12_000_000)).toEqual({ width: 4000, height: 3000, limitedByMemory: true })
	})

	it('keeps AVIF out of compatible auto mode and adds it to smallest mode', () => {
		const input = { sourceFormat: 'jpeg' as const, classification: 'photo' as const, analysis, options, sourceBytes: 2_000_000, pixels: 12_000_000 }
		expect(buildCandidatePlans(input).some(plan => plan.format === 'avif')).toBe(false)
		expect(buildCandidatePlans({ ...input, options: { ...options, compatibility: 'smallest' } }).some(plan => plan.format === 'avif')).toBe(true)
	})

	it('uses 4:4:4 JPEG for UI text', () => {
		expect(jpegOptions('smart', 'ui-text')).toMatchObject({ quality: 86, auto_subsample: false, chroma_subsample: 1 })
		expect(jpegOptions('smart', 'photo')).toMatchObject({ quality: 78, chroma_subsample: 2 })
	})

	it('does not classify textured photos as UI', () => {
		expect(classifyImage({ ...analysis, flatAreaRatio: 0.28, edgeDensity: 0.48, hvEdgeRatio: 0.53, lumaEntropy: 5.65, noiseScore: 0.012 })).not.toBe('ui-text')
		expect(classifyImage({ ...analysis, flatAreaRatio: 0.62, edgeDensity: 0.16, hvEdgeRatio: 0.75, lumaEntropy: 4.6, noiseScore: 0.002 })).toBe('ui-text')
	})
})
