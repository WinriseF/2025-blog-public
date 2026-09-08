import { describe, expect, it } from 'vitest'
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
	it('applies both width and pixel limits without changing aspect ratio', () => {
		expect(computeTargetSize(8000, 6000, 4000, 24_000_000)).toEqual({ width: 4000, height: 3000, limitedByMemory: false })
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
})
