import { loadAvifEncoder, loadJpegEncoder, loadOxiPng, loadPngEncoder, loadWebpEncoder, quantizeImage } from './cdn'
import { flattenAlpha } from './decode'
import { avifOptions, jpegOptions, webpOptions } from './presets'
import { assertOutputFormat } from './sniff'
import type { CandidatePlan, ImageAnalysis, ImageClass, ImageCompressionOptions, ImageQualityMetrics, PngQuantizationOptions } from './types'

export type EncodedCandidate = {
	format: CandidatePlan['format']
	bytes: ArrayBuffer
	encoder: string
	preview?: ImageData
	metrics?: ImageQualityMetrics
	paletteColors?: number
	quantization?: PngQuantizationOptions
	optimiseAlpha?: boolean
}

function exactBuffer(bytes: Uint8Array) {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export async function encodeCandidate(
	plan: CandidatePlan,
	image: ImageData,
	analysis: ImageAnalysis,
	classification: ImageClass,
	options: ImageCompressionOptions
): Promise<EncodedCandidate> {
	let bytes: ArrayBuffer
	let encoder: string
	let preview: ImageData | undefined

	if (plan.format === 'jpeg') {
		const module = await loadJpegEncoder()
		bytes = await module.encode(analysis.alphaCoverage > 0 ? flattenAlpha(image, options.jpegBackground) : image, jpegOptions(options.preset, classification))
		encoder = 'MozJPEG'
	} else if (plan.format === 'webp') {
		const module = await loadWebpEncoder()
		bytes = await module.encode(image, webpOptions(options.preset, plan.variant === 'lossless'))
		encoder = plan.variant === 'lossless' ? 'libwebp lossless/near-lossless' : 'libwebp'
	} else if (plan.format === 'avif') {
		const module = await loadAvifEncoder()
		bytes = await module.encode(image, avifOptions(options.preset, classification))
		encoder = 'libavif'
	} else if (plan.variant === 'quantized') {
		if (!plan.quantization) throw new Error('PNG 量化候选缺少参数')
		const quantized = await quantizeImage(image, plan.quantization)
		const oxipng = await loadOxiPng()
		bytes = await oxipng.optimise(quantized.bytes, { level: options.preset === 'smaller' ? 4 : 2, interlace: false, optimiseAlpha: false })
		preview = quantized.imageData
		encoder = `libimagequant ${quantized.paletteLength} colors + OxiPNG`
		const normalized = bytes instanceof ArrayBuffer ? bytes : exactBuffer(bytes)
		assertOutputFormat(new Uint8Array(normalized), plan.format)
		return { format: plan.format, bytes: normalized, encoder, preview, paletteColors: quantized.paletteLength, quantization: plan.quantization }
	} else {
		const [png, oxipng] = await Promise.all([loadPngEncoder(), loadOxiPng()])
		const encoded = await png.encode(image)
		bytes = await oxipng.optimise(encoded, { level: options.preset === 'smaller' ? 4 : 2, interlace: false, optimiseAlpha: Boolean(plan.optimiseAlpha) })
		encoder = plan.optimiseAlpha ? 'PNG + OxiPNG (transparent RGB optimized)' : 'PNG + OxiPNG'
	}

	const normalized = bytes instanceof ArrayBuffer ? bytes : exactBuffer(bytes)
	assertOutputFormat(new Uint8Array(normalized), plan.format)
	return { format: plan.format, bytes: normalized, encoder, preview, optimiseAlpha: plan.optimiseAlpha }
}
