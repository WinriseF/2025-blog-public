import type { CandidatePlan, ImageAnalysis, ImageClass, ImageCompressionOptions, ImageFormat } from './types'

export const DEFAULT_IMAGE_COMPRESSION_OPTIONS: ImageCompressionOptions = {
	preset: 'smart',
	output: 'keep',
	compatibility: 'compatible',
	stripMetadata: false,
	jpegBackground: '#ffffff'
}

export function buildCandidatePlans(input: {
	sourceFormat: ImageFormat
	classification: ImageClass
	analysis: ImageAnalysis
	options: ImageCompressionOptions
	sourceBytes: number
	pixels: number
}) {
	const { sourceFormat, classification, analysis, options, sourceBytes, pixels } = input
	const plans: CandidatePlan[] = []
	const add = (plan: CandidatePlan) => {
		const key = JSON.stringify(plan)
		if (!plans.some(item => JSON.stringify(item) === key)) plans.push(plan)
	}
	const addPngQuantized = () => {
		add({ format: 'png', variant: 'quantized' })
	}
	const graphic = classification === 'ui-text' || classification === 'flat-illustration' || classification === 'transparent-icon'
	const addJpeg = () => {
		const distances = jpegliDistances(options.preset, classification)
		for (const jpegDistance of options.preset === 'smaller' ? distances : [distances[1]]) add({ format: 'jpeg', variant: 'lossy', jpegDistance })
	}

	const addSameFormat = () => {
		if (sourceFormat === 'jpeg') addJpeg()
		else if (sourceFormat === 'png') addPngQuantized()
		else if (sourceFormat === 'webp' && graphic) add({ format: 'webp', variant: 'lossless' })
		else add({ format: sourceFormat, variant: 'lossy' })
	}

	if (options.output === 'keep') {
		addSameFormat()
		return plans
	}

	if (options.output !== 'auto') {
		if (options.output === 'jpeg') addJpeg()
		else if (options.output === 'png') addPngQuantized()
		else if (options.output === 'webp' && graphic) add({ format: 'webp', variant: 'lossless' })
		else add({ format: options.output, variant: 'lossy' })
		return plans
	}

	addSameFormat()
	if (graphic || analysis.alphaCoverage > 0) {
		add({ format: 'webp', variant: 'lossless' })
		addPngQuantized()
	} else {
		add({ format: 'webp', variant: 'lossy' })
	}
	if (options.compatibility === 'smallest' && sourceBytes >= 40 * 1024 && pixels >= 64_000 && classification !== 'transparent-icon') add({ format: 'avif', variant: 'lossy' })
	if (options.compatibility === 'smallest' && sourceBytes >= 40 * 1024 && pixels >= 64_000) add({ format: 'jxl', variant: 'lossy' })
	return plans
}

export function jpegliDistances(preset: ImageCompressionOptions['preset'], classification: ImageClass) {
	const text = classification === 'ui-text' || classification === 'flat-illustration'
	if (text) {
		if (preset === 'smaller') return [1.5, 3, 5, 7]
		if (preset === 'higher') return [0.6, 1.5, 2.5, 4]
		return [1, 2.5, 4, 6]
	}
	if (preset === 'smaller') return [2.5, 5.5, 9, 13]
	if (preset === 'higher') return [1, 2.5, 4, 6]
	return [1.5, 3.5, 6, 9]
}

export function jpegliOptions(preset: ImageCompressionOptions['preset'], classification: ImageClass, distance = jpegliDistances(preset, classification)[0]) {
	const text = classification === 'ui-text' || classification === 'flat-illustration'
	return {
		distance,
		chromaSubsampling: text ? '444' : '420',
		progressive: true,
		adaptiveQuantization: true,
		optimizeCoding: true
	}
}

export function webpOptions(preset: ImageCompressionOptions['preset'], lossless: boolean) {
	if (lossless) {
		return {
			lossless: 1,
			near_lossless: preset === 'smaller' ? 80 : preset === 'higher' ? 100 : 90,
			method: 6,
			alpha_quality: 100,
			exact: 0
		}
	}
	return {
		quality: preset === 'smaller' ? 68 : preset === 'higher' ? 86 : 78,
		method: preset === 'smaller' ? 6 : 5,
		pass: preset === 'smaller' ? 4 : 2,
		sns_strength: preset === 'smaller' ? 70 : preset === 'higher' ? 40 : 50,
		filter_strength: preset === 'smaller' ? 50 : 60,
		filter_sharpness: preset === 'smaller' ? 2 : 0,
		autofilter: 1,
		alpha_quality: 100,
		use_sharp_yuv: 1
	}
}

export function avifOptions(preset: ImageCompressionOptions['preset'], classification: ImageClass) {
	const text = classification === 'ui-text' || classification === 'flat-illustration'
	return {
		quality: preset === 'smaller' ? 48 : preset === 'higher' ? 76 : 62,
		qualityAlpha: preset === 'smaller' ? 65 : preset === 'higher' ? 90 : 75,
		speed: preset === 'smaller' ? 7 : 6,
		subsample: text ? 3 : 1,
		sharpness: preset === 'smaller' ? 1 : 0,
		tune: 2,
		enableSharpYUV: !text,
		denoiseLevel: 0,
		bitDepth: 8,
		lossless: false
	}
}

export function jxlOptions(preset: ImageCompressionOptions['preset']) {
	return {
		effort: preset === 'smaller' ? 8 : 7,
		quality: preset === 'smaller' ? 68 : preset === 'higher' ? 88 : 78,
		progressive: false,
		epf: -1,
		lossyPalette: false,
		decodingSpeedTier: 0,
		photonNoiseIso: 0,
		lossyModular: false
	}
}

export function outputFileName(sourceName: string, format: ImageFormat, suffix = '-compressed') {
	const base = sourceName.replace(/\.[^.]+$/, '') || 'image'
	const extension = format === 'jpeg' ? 'jpg' : format
	return `${base}${suffix}.${extension}`
}
