import { describe, expect, it } from 'vitest'
import { buildPngQuantizationCandidates } from '../../src/lib/image-compress/cdn'
import { classifyImage } from '../../src/lib/image-compress/features'
import { buildCandidatePlans, jpegliDistances, jpegliOptions } from '../../src/lib/image-compress/presets'
import { passesQualityGate } from '../../src/lib/image-compress/quality'
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
			expect(plans.some(plan => plan.format === 'png' && plan.variant === 'quantized')).toBe(true)
			expect(plans.some(plan => plan.format === 'png' && plan.variant !== 'quantized')).toBe(false)
		}
	})

	it('searches every smaller mixed palette without stopping at 128 colors', () => {
		const quantized = buildPngQuantizationCandidates('smaller', 'mixed', analysis)
		expect(quantized.map(item => item.maxColors)).toEqual([128, 128, 64, 64, 32, 32, 16, 16])
		expect(new Set(quantized.map(item => item.dithering))).toEqual(new Set([0.05, 0.1]))
		expect(new Set(quantized.map(item => item.targetQuality))).toEqual(new Set([50]))
	})

	it('tries 8/4 colors without dithering for icons while keeping photos conservative', () => {
		const icon = buildPngQuantizationCandidates('smaller', 'transparent-icon', analysis)
		const photo = buildPngQuantizationCandidates('smaller', 'photo', analysis)
		expect(icon.map(item => item.maxColors)).toEqual([128, 64, 32, 16, 8, 4])
		expect(icon.every(item => item.dithering === 0 && item.targetQuality === 45)).toBe(true)
		expect(photo.map(item => item.maxColors)).toEqual([128, 128, 64, 64])
		expect(new Set(photo.map(item => item.dithering))).toEqual(new Set([0.15, 0.25]))
	})

	it('keeps modern-only formats out of compatible auto mode and adds them to smallest mode', () => {
		const input = { sourceFormat: 'jpeg' as const, classification: 'photo' as const, analysis, options, sourceBytes: 2_000_000, pixels: 12_000_000 }
		expect(buildCandidatePlans(input).some(plan => plan.format === 'avif')).toBe(false)
		expect(buildCandidatePlans(input).some(plan => plan.format === 'jxl')).toBe(false)
		const smallest = buildCandidatePlans({ ...input, options: { ...options, compatibility: 'smallest' } })
		expect(smallest.some(plan => plan.format === 'avif')).toBe(true)
		expect(smallest.some(plan => plan.format === 'jxl')).toBe(true)
	})

	it('searches bounded JPEGli distances and maps chroma sampling', () => {
		expect(jpegliDistances('higher', 'photo')).toEqual([1, 2.5, 4, 6])
		expect(jpegliDistances('smart', 'photo')).toEqual([1.5, 3.5, 6, 9])
		expect(jpegliDistances('smaller', 'photo')).toEqual([2.5, 5.5, 9, 13])
		expect(jpegliDistances('higher', 'ui-text')).toEqual([0.6, 1.5, 2.5, 4])
		const plans = buildCandidatePlans({ sourceFormat: 'jpeg', classification: 'photo', analysis, options: { ...options, preset: 'higher', output: 'keep' }, sourceBytes: 2_000_000, pixels: 12_000_000 })
		expect(plans.map(plan => plan.jpegDistance)).toEqual([2.5])
		const exhaustive = buildCandidatePlans({ sourceFormat: 'jpeg', classification: 'photo', analysis, options: { ...options, preset: 'smaller', output: 'keep' }, sourceBytes: 2_000_000, pixels: 12_000_000 })
		expect(exhaustive.map(plan => plan.jpegDistance)).toEqual([2.5, 5.5, 9, 13])
		expect(jpegliOptions('smart', 'ui-text')).toMatchObject({ distance: 1, chromaSubsampling: '444', adaptiveQuantization: true })
		expect(jpegliOptions('higher', 'photo', 6)).toMatchObject({ distance: 6, chromaSubsampling: '420', progressive: true })
	})

	it('does not classify textured photos as UI', () => {
		expect(classifyImage({ ...analysis, flatAreaRatio: 0.28, edgeDensity: 0.48, hvEdgeRatio: 0.53, lumaEntropy: 5.65, noiseScore: 0.012 })).not.toBe('ui-text')
		expect(classifyImage({ ...analysis, flatAreaRatio: 0.62, edgeDensity: 0.16, hvEdgeRatio: 0.75, lumaEntropy: 4.6, noiseScore: 0.002 })).toBe('ui-text')
	})

	it('uses a stricter smaller edge gate for UI text without weakening other presets', () => {
		expect(passesQualityGate({ ssim: 0.965, edgeError: 0.09, alphaMae: 0.012 }, 'mixed', 'smaller')).toBe(true)
		expect(passesQualityGate({ ssim: 0.965, edgeError: 0.09, alphaMae: 0.012 }, 'ui-text', 'smaller')).toBe(false)
		expect(passesQualityGate({ ssim: 0.965, edgeError: 0.09, alphaMae: 0.016 }, 'mixed', 'smaller')).toBe(false)
		expect(passesQualityGate({ ssim: 0.984, edgeError: 0.03, alphaMae: 0 }, 'mixed', 'smart')).toBe(false)
	})
})
