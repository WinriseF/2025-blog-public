import type { CandidatePlan, ImageAnalysis, ImageClass, ImageCompressionOptions, ImageFormat } from './types'

export function computeTargetSize(width: number, height: number, maxWidth: number | undefined, maxPixels: number) {
	const widthScale = maxWidth && width > maxWidth ? maxWidth / width : 1
	const memoryScale = width * height > maxPixels ? Math.sqrt(maxPixels / (width * height)) : 1
	const scale = Math.min(widthScale, memoryScale)
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
		limitedByMemory: memoryScale < widthScale
	}
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
	const add = (format: ImageFormat, variant: CandidatePlan['variant']) => {
		if (!plans.some(item => item.format === format && item.variant === variant)) plans.push({ format, variant })
	}
	const graphic = classification === 'ui-text' || classification === 'flat-illustration' || classification === 'transparent-icon'
	const quantizationSafe = analysis.gradientRatio < 0.42 && analysis.semiTransparent < 0.35

	const addSameFormat = () => {
		if (sourceFormat === 'png') {
			add('png', 'lossless')
			if (quantizationSafe) add('png', 'quantized')
		} else if (sourceFormat === 'webp' && graphic) add('webp', 'lossless')
		else add(sourceFormat, 'lossy')
	}

	if (options.output === 'keep') {
		addSameFormat()
		return plans
	}

	if (options.output !== 'auto') {
		if (options.output === 'png') {
			add('png', 'lossless')
			if (quantizationSafe) add('png', 'quantized')
		} else if (options.output === 'webp' && graphic) add('webp', 'lossless')
		else add(options.output, 'lossy')
		return plans
	}

	addSameFormat()
	if (graphic || analysis.alphaCoverage > 0) {
		add('webp', 'lossless')
		if (quantizationSafe) add('png', 'quantized')
	} else {
		add('webp', 'lossy')
	}
	if (options.compatibility === 'smallest' && sourceBytes >= 40 * 1024 && pixels >= 64_000 && classification !== 'transparent-icon') add('avif', 'lossy')
	return plans
}

export function jpegOptions(preset: ImageCompressionOptions['preset'], classification: ImageClass) {
	const text = classification === 'ui-text' || classification === 'flat-illustration'
	const quality = text
		? preset === 'smaller' ? 82 : preset === 'higher' ? 92 : 86
		: preset === 'smaller' ? 70 : preset === 'higher' ? 86 : 78
	return {
		quality,
		progressive: true,
		optimize_coding: true,
		smoothing: 0,
		quant_table: 3,
		auto_subsample: false,
		chroma_subsample: text ? 1 : 2,
		trellis_multipass: preset === 'smaller',
		trellis_opt_zero: preset === 'smaller',
		trellis_opt_table: preset === 'smaller',
		trellis_loops: preset === 'smaller' ? 2 : 1
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

export function outputFileName(sourceName: string, format: ImageFormat, suffix = '-compressed') {
	const base = sourceName.replace(/\.[^.]+$/, '') || 'image'
	const extension = format === 'jpeg' ? 'jpg' : format
	return `${base}${suffix}.${extension}`
}
