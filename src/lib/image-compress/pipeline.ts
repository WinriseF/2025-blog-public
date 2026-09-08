import { decodeEncodedCandidate, decodeImageInWorker, flattenAlpha } from './decode'
import { encodeCandidate, type EncodedCandidate } from './encode'
import { analyzeImage, classifyImage, sampleImageData } from './features'
import { inspectImageMetadata } from './metadata'
import { buildCandidatePlans } from './presets'
import { compareImageQuality, passesQualityGate } from './quality'
import { IMAGE_FORMAT_META, inspectImageContainer } from './sniff'
import type {
	DecodedImagePayload,
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

type Progress = (stage: ImageJobStage, progress?: number, detail?: string) => void
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
	const decoded = candidate.preview ?? await decodeEncodedCandidate(candidate.bytes, candidate.format, reference.width, reference.height)
	if (!decoded) {
		const metrics = { ssim: 1, edgeError: 0, alphaMae: 0 }
		return { ...candidate, metrics, passed: true, warning: '当前浏览器无法执行预览质量门禁' }
	}
	const sampledReference = sampleImageData(reference, 384)
	const metrics = compareImageQuality(candidate.format === 'jpeg' ? flattenAlpha(sampledReference, options.jpegBackground) : sampledReference, decoded)
	return { ...candidate, metrics, passed: passesQualityGate(metrics, classification, options.preset), warning: null }
}

function makeResult(candidate: EncodedCandidate, input: {
	originalBytes: number
	width: number
	height: number
	classification: ImageCompressionResult['classification']
	warnings: string[]
	usedOriginal: boolean
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
		warnings: input.warnings
	}
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
	if ((metadata.wideGamut || metadata.colorUncertain) && (options.output === 'keep' || options.output === 'auto') && !options.maxWidth && !options.stripMetadata) {
		warnings.push(`${metadata.colorUncertain ? 'ICC' : '广色域'} 安全保护已保留原文件；如需转换，请明确选择输出格式`)
		const swapsAxes = metadata.orientation >= 5 && metadata.orientation <= 8
		return makeResult({ format: sourceFormat, bytes: sourceBuffer, encoder: metadata.colorUncertain ? 'ICC 安全回退' : '广色域安全回退' }, {
			originalBytes: file.size,
			width: swapsAxes ? container.height : container.width,
			height: swapsAxes ? container.width : container.height,
			classification: 'mixed',
			warnings,
			usedOriginal: true
		})
	}

	onProgress('decode', 0.18)
	let image: ImageData
	if (input.decoded) {
		image = new ImageData(new Uint8ClampedArray(input.decoded.data), input.decoded.width, input.decoded.height)
		warnings.push(...input.decoded.warnings)
	} else {
		try {
			const decoded = await decodeImageInWorker(file, container.width, container.height, options, limits)
			image = decoded.image
			warnings.push(...decoded.warnings)
		} catch (error) {
			throw error
		}
	}

	onProgress('analyze', 0.3)
	const analysis = analyzeImage(image)
	const classification = classifyImage(analysis)
	const sourceWidth = metadata.orientation >= 5 && metadata.orientation <= 8 ? container.height : container.width
	const sourceHeight = metadata.orientation >= 5 && metadata.orientation <= 8 ? container.width : container.height
	const resized = Boolean(options.maxWidth || (sourceWidth && sourceHeight && (sourceWidth !== image.width || sourceHeight !== image.height)) || warnings.some(message => /缩小|限制像素/.test(message)))
	const plans = buildCandidatePlans({
		sourceFormat,
		classification,
		analysis,
		options,
		sourceBytes: file.size,
		pixels: image.width * image.height
	}).filter(plan => !(limits.lowMemory && options.output === 'auto' && plan.format === 'avif'))

	const baseline = canUseOriginal(options, resized)
		? ({ format: sourceFormat, bytes: sourceBuffer, encoder: '保留原文件' } satisfies EncodedCandidate)
		: null
	let best: RankedCandidate | null = baseline ? { ...baseline, metrics: { ssim: 1, edgeError: 0, alphaMae: 0 }, passed: true } : null
	let fallback: RankedCandidate | null = null
	const failures: string[] = []

	for (let index = 0; index < plans.length; index += 1) {
		const plan = plans[index]
		onProgress('encode', 0.35 + index / Math.max(1, plans.length) * 0.45, `${plan.format}:${plan.variant}`)
		try {
			const encoded = await encodeCandidate(plan, image, analysis, classification, options)
			onProgress('evaluate', 0.72 + index / Math.max(1, plans.length) * 0.2, plan.format)
			const ranked = await rankCandidate(encoded, image, classification, options)
			if (ranked.warning) warnings.push(ranked.warning)
			if (!ranked.passed) {
				if (!fallback || ranked.metrics.ssim > fallback.metrics.ssim) fallback = ranked
				continue
			}
			if (!best || meaningfulGain(ranked, best.bytes.byteLength, best.format, options.compatibility)) best = ranked
		} catch (error) {
			failures.push(`${plan.format}: ${errorMessage(error)}`)
		}
	}

	if (!best && fallback) {
		throw new ImagePipelineError('QUALITY_GATE_FAILED', `编码结果未达到质量门禁（SSIM ${fallback.metrics.ssim.toFixed(4)}）`)
	}
	if (!best) {
		const detail = failures.join('；') || '没有可用的编码结果'
		const cdnFailure = /fetch|import|network|module|cdn|wasm/i.test(detail)
		throw new ImagePipelineError(cdnFailure ? 'CDN_UNAVAILABLE' : 'ENCODE_FAILED', cdnFailure ? `无法加载远程编码器：${detail}` : detail)
	}

	if (failures.length && best.encoder === '保留原文件') warnings.push(`部分候选未生成：${failures.join('；')}`)
	if (best.encoder === '保留原文件') warnings.push('原文件已经足够小，已保留原文件')
	else if (best.bytes.byteLength >= file.size) warnings.push('当前操作为强制转换、缩放或清理元数据，因此输出可能大于原文件')
	if (best.format === 'jpeg' && analysis.alphaCoverage > 0) warnings.push(`透明区域已使用 ${options.jpegBackground} 背景填充`)
	if (metadata.hasIcc && !metadata.wideGamut && best.encoder !== '保留原文件') warnings.push('输入包含 ICC；重编码结果已按浏览器标准 RGB 解码链生成')
	onProgress('evaluate', 0.98)
	return makeResult(best, {
		originalBytes: file.size,
		width: image.width,
		height: image.height,
		classification,
		warnings: [...new Set(warnings)],
		usedOriginal: best.encoder === '保留原文件'
	})
}
