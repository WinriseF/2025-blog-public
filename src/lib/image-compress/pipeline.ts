import { decodeEncodedCandidate, decodeImageInWorker, flattenAlpha, resizeQualityPreview } from './decode'
import { buildPngQuantizationCandidates } from './cdn'
import { encodeCandidate, type EncodedCandidate } from './encode'
import { analyzeImage, classifyImage, sampleImageData } from './features'
import { inspectImageMetadata } from './metadata'
import { buildCandidatePlans } from './presets'
import { compareImageQuality, passesQualityGate } from './quality'
import { IMAGE_FORMAT_META, inspectImageContainer } from './sniff'
import type {
	DecodedImagePayload,
	ImageCompressionDiagnostic,
	ImageCompressionOptions,
	ImageCompressionResult,
	ImageDeviceLimits,
	ImageFormat,
	ImageJobStage,
	ImageQualityMetrics
} from './types'

export class ImagePipelineError extends Error {
	constructor(public code: 'UNSUPPORTED_FORMAT' | 'ANIMATED_IMAGE' | 'DECODE_FAILED' | 'ENCODE_FAILED' | 'QUALITY_GATE_FAILED' | 'CDN_UNAVAILABLE' | 'OUT_OF_MEMORY', message: string) {
		super(message)
	}
}

type Progress = (stage: ImageJobStage, progress?: number) => void
type RankedCandidate = EncodedCandidate & { metrics: ImageQualityMetrics; passed: boolean }

function sourceError(format: ReturnType<typeof inspectImageContainer>['format']) {
	if (format === 'heic') return '暂不支持 HEIC/HEIF，避免 HDR、广色域或高位深内容被静默降质'
	if (format === 'gif') return '暂不支持 GIF；本工具不会自动提取第一帧，以免丢失动画'
	if (format === 'svg') return 'SVG 是矢量文档，请使用独立的矢量优化工具'
	return '无法识别图片的真实格式，仅支持静态 JPEG、PNG、WebP 和 AVIF'
}

function canUseOriginal(options: ImageCompressionOptions, resized: boolean) {
	return (options.output === 'keep' || options.output === 'auto') && !options.stripMetadata && !resized
}

function meaningfulGain(candidate: RankedCandidate, bestBytes: number, bestFormat: ImageFormat, compatibility: ImageCompressionOptions['compatibility']) {
	if (candidate.bytes.byteLength >= bestBytes) return false
	const absoluteGain = bestBytes - candidate.bytes.byteLength
	let relativeGain = candidate.format === bestFormat ? 0.01 : 0.03
	if (candidate.format === 'avif') relativeGain = compatibility === 'smallest' ? 0.05 : 0.1
	if (candidate.encoder.includes('libimagequant')) relativeGain = 0.05
	return absoluteGain >= 4096 || candidate.bytes.byteLength <= bestBytes * (1 - relativeGain)
}

async function rankCandidate(candidate: EncodedCandidate, reference: ImageData, classification: Parameters<typeof passesQualityGate>[1], options: ImageCompressionOptions) {
	const { preview, ...encoded } = candidate
	if (preview) {
		const metrics = compareImageQuality(sampleImageData(reference, 384), sampleImageData(preview, 384))
		return { ...encoded, metrics, passed: passesQualityGate(metrics, classification, options.preset) && (!encoded.optimiseAlpha || metrics.alphaMae === 0) }
	}
	const decoded = await decodeEncodedCandidate(candidate.bytes, candidate.format, reference.width, reference.height)
	if (!decoded) {
		throw new ImagePipelineError('QUALITY_GATE_FAILED', '当前浏览器无法检查该编码结果的画质')
	}
	const sampledReference = await resizeQualityPreview(reference, decoded.width, decoded.height) ?? sampleImageData(reference, 384)
	const metrics = compareImageQuality(candidate.format === 'jpeg' ? flattenAlpha(sampledReference, options.jpegBackground) : sampledReference, decoded)
	return { ...encoded, metrics, passed: passesQualityGate(metrics, classification, options.preset) && (!encoded.optimiseAlpha || metrics.alphaMae === 0) }
}

function makeResult(candidate: EncodedCandidate, input: {
	originalBytes: number
	width: number
	height: number
	classification: ImageCompressionResult['classification']
	warnings: string[]
	usedOriginal: boolean
	diagnostics: ImageCompressionDiagnostic[]
}): ImageCompressionResult {
	const meta = IMAGE_FORMAT_META[candidate.format]
	return {
		bytes: candidate.bytes,
		format: candidate.format,
		mime: meta.mime,
		extension: meta.extension,
		width: input.width,
		height: input.height,
		originalBytes: input.originalBytes,
		outputBytes: candidate.bytes.byteLength,
		usedOriginal: input.usedOriginal,
		classification: input.classification,
		encoder: candidate.encoder,
		metrics: candidate.metrics,
		diagnostics: input.diagnostics,
		warnings: input.warnings
	}
}

function candidateDiagnostic(reason: ImageCompressionDiagnostic['reason'], candidate: Partial<RankedCandidate>, originalBytes: number, classification: ImageCompressionResult['classification']): ImageCompressionDiagnostic {
	return {
		reason,
		originalBytes,
		finalBytes: originalBytes,
		candidateBytes: candidate.bytes?.byteLength,
		classification,
		paletteColors: candidate.paletteColors ?? candidate.quantization?.maxColors,
		targetQuality: candidate.quantization?.targetQuality,
		dithering: candidate.quantization?.dithering,
		optimiseAlpha: candidate.optimiseAlpha,
		metrics: candidate.metrics
	}
}

function withFinalBytes(diagnostics: ImageCompressionDiagnostic[], finalBytes: number) {
	return diagnostics.map(diagnostic => ({ ...diagnostic, finalBytes }))
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

export async function compressImage(input: {
	file: File
	options: ImageCompressionOptions
	limits: ImageDeviceLimits
	decoded?: DecodedImagePayload
	onProgress: Progress
}) {
	const { file, options, limits, onProgress } = input
	onProgress('validate', 0.04)
	let sourceBuffer: ArrayBuffer
	try {
		sourceBuffer = await file.arrayBuffer()
	} catch (error) {
		throw new ImagePipelineError('DECODE_FAILED', `无法读取图片：${errorMessage(error)}`)
	}
	const sourceBytes = new Uint8Array(sourceBuffer)
	const container = inspectImageContainer(sourceBytes)
	if (!['jpeg', 'png', 'webp', 'avif'].includes(container.format)) throw new ImagePipelineError('UNSUPPORTED_FORMAT', sourceError(container.format))
	if (container.animated) throw new ImagePipelineError('ANIMATED_IMAGE', '检测到动态图；当前版本不会提取第一帧或破坏动画')
	const sourceFormat = container.format as ImageFormat

	onProgress('metadata', 0.1)
	const metadata = await inspectImageMetadata(file, sourceBytes, sourceFormat)
	const warnings = metadata.warning ? [metadata.warning] : []
	if (metadata.wideGamut) warnings.push('检测到广色域配置；输出会通过浏览器解码链转换为标准 RGB，建议对关键颜色进行人工比较')
	if (metadata.hasGps && !options.stripMetadata) warnings.push('原图包含定位信息；关闭元数据清理时可能随原文件保留')
	if ((metadata.wideGamut || metadata.colorUncertain) && (options.output === 'keep' || options.output === 'auto') && !options.stripMetadata) {
		warnings.push(`${metadata.colorUncertain ? 'ICC' : '广色域'} 安全保护已保留原文件；如需转换，请明确选择输出格式`)
		const swapsAxes = metadata.orientation >= 5 && metadata.orientation <= 8
		return makeResult({ format: sourceFormat, bytes: sourceBuffer, encoder: metadata.colorUncertain ? 'ICC 安全回退' : '广色域安全回退' }, {
			originalBytes: file.size,
			width: swapsAxes ? container.height : container.width,
			height: swapsAxes ? container.width : container.height,
			classification: 'mixed',
			warnings,
			usedOriginal: true,
			diagnostics: [{
				reason: metadata.colorUncertain ? 'icc-uncertain' : 'wide-gamut',
				originalBytes: file.size,
				finalBytes: file.size,
				classification: 'mixed'
			}]
		})
	}

	onProgress('decode', 0.18)
	let image: ImageData
	if (input.decoded) {
		image = new ImageData(new Uint8ClampedArray(input.decoded.data), input.decoded.width, input.decoded.height)
		warnings.push(...input.decoded.warnings)
	} else {
		const decoded = await decodeImageInWorker(file)
		image = decoded.image
		warnings.push(...decoded.warnings)
	}

	onProgress('analyze', 0.3)
	const analysis = analyzeImage(image)
	const classification = classifyImage(analysis)
	const sourceWidth = metadata.orientation >= 5 && metadata.orientation <= 8 ? container.height : container.width
	const sourceHeight = metadata.orientation >= 5 && metadata.orientation <= 8 ? container.width : container.height
	const resized = Boolean(sourceWidth && sourceHeight && (sourceWidth !== image.width || sourceHeight !== image.height))
	const plans = buildCandidatePlans({
		sourceFormat,
		classification,
		analysis,
		options,
		sourceBytes: file.size,
		pixels: image.width * image.height
	}).flatMap(plan => plan.variant === 'quantized'
		? buildPngQuantizationCandidates(options.preset, classification, analysis).map(quantization => ({ ...plan, quantization }))
		: [plan]
	).filter(plan => !(limits.lowMemory && options.output === 'auto' && plan.format === 'avif'))

	const baseline: RankedCandidate | null = canUseOriginal(options, resized)
		? { format: sourceFormat, bytes: sourceBuffer, encoder: '保留原文件', metrics: { ssim: 1, edgeError: 0, alphaMae: 0 }, passed: true }
		: null
	let smallest: RankedCandidate | null = null
	let fallback: Pick<RankedCandidate, 'format' | 'metrics'> | null = null
	const failures: string[] = []
	const diagnostics: ImageCompressionDiagnostic[] = []

	for (let index = 0; index < plans.length; index += 1) {
		const plan = plans[index]
		onProgress('encode', 0.35 + index / plans.length * 0.6)
		try {
			const encoded = await encodeCandidate(plan, image, analysis, classification, options)
			onProgress('evaluate', 0.35 + (index + 0.8) / plans.length * 0.6)
			const ranked = await rankCandidate(encoded, image, classification, options)
			if (!ranked.passed) {
				diagnostics.push(candidateDiagnostic('quality-rejected', ranked, file.size, classification))
				if (!fallback || ranked.metrics.ssim > fallback.metrics.ssim) fallback = { format: ranked.format, metrics: ranked.metrics }
				continue
			}
			if (!smallest || ranked.bytes.byteLength < smallest.bytes.byteLength) smallest = ranked
		} catch (error) {
			failures.push(`${plan.format}:${plan.variant}: ${errorMessage(error)}`)
			if (plan.variant === 'quantized') diagnostics.push(candidateDiagnostic('quantize-failed', { quantization: plan.quantization }, file.size, classification))
		}
	}

	if (!baseline && !smallest && fallback) {
		throw new ImagePipelineError('QUALITY_GATE_FAILED', `编码结果未达到质量门禁（SSIM ${fallback.metrics.ssim.toFixed(4)}）`)
	}
	if (!baseline && !smallest) {
		const detail = failures.join('；') || '没有可用的编码结果'
		const cdnFailure = /fetch|import|network|module|cdn|wasm/i.test(detail)
		throw new ImagePipelineError(cdnFailure ? 'CDN_UNAVAILABLE' : 'ENCODE_FAILED', cdnFailure ? `无法加载远程编码器：${detail}` : detail)
	}
	let best = smallest ?? baseline!
	if (baseline && (!smallest || !meaningfulGain(smallest, baseline.bytes.byteLength, baseline.format, options.compatibility))) {
		best = baseline
		if (smallest) diagnostics.push(candidateDiagnostic('no-meaningful-gain', smallest, file.size, classification))
	}
	if (best.encoder.includes('libimagequant')) diagnostics.push(candidateDiagnostic('quantized-selected', best, file.size, classification))
	else if (best.format === 'png' && best.encoder.startsWith('PNG + OxiPNG') && best.bytes.byteLength < file.size) diagnostics.push(candidateDiagnostic('lossless-smaller', best, file.size, classification))

	if (best.encoder === '保留原文件') {
		if (smallest) warnings.push('重新编码未带来足够的体积收益，已保留原文件')
		else if (fallback) warnings.push(`候选未通过质量门禁（最佳 SSIM ${fallback.metrics.ssim.toFixed(4)}），已保留原文件`)
		else if (failures.length) warnings.push(`候选编码失败，已保留原文件：${failures.join('；')}`)
	}
	else if (best.bytes.byteLength >= file.size) warnings.push('当前操作为强制转换或清理元数据，因此输出可能大于原文件')
	if (best.encoder.startsWith('PNG + OxiPNG')) {
		const quantizationFailure = failures.find(message => message.startsWith('png:quantized:'))
		if (quantizationFailure) warnings.push(`PNG 量化失败，已使用无损压缩：${quantizationFailure}`)
		else if (fallback?.format === 'png') warnings.push('PNG 量化结果未达到画质要求，已使用无损压缩')
	}
	if (best.format === 'jpeg' && analysis.alphaCoverage > 0) warnings.push(`透明区域已使用 ${options.jpegBackground} 背景填充`)
	if (metadata.hasIcc && !metadata.wideGamut && best.encoder !== '保留原文件') warnings.push('输入包含 ICC；重编码结果已按浏览器标准 RGB 解码链生成')
	onProgress('evaluate', 0.98)
	return makeResult(best, {
		originalBytes: file.size,
		width: image.width,
		height: image.height,
		classification,
		warnings: [...new Set(warnings)],
		usedOriginal: best.encoder === '保留原文件',
		diagnostics: withFinalBytes(diagnostics, best.bytes.byteLength)
	})
}
