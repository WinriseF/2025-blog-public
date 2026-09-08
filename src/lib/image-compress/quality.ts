import { sampleImageData } from './features'
import type { ImageClass, ImageCompressionPreset, ImageQualityMetrics } from './types'

function luma(data: Uint8ClampedArray, offset: number) {
	return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722
}

export function compareImageQuality(referenceSource: ImageData, candidateSource: ImageData): ImageQualityMetrics {
	const reference = sampleImageData(referenceSource, 384)
	const candidate = candidateSource.width === reference.width && candidateSource.height === reference.height
		? candidateSource
		: sampleImageData(candidateSource, Math.max(reference.width, reference.height))
	const count = Math.min(reference.width * reference.height, candidate.width * candidate.height)
	let meanX = 0
	let meanY = 0
	let alphaError = 0
	for (let index = 0; index < count; index += 1) {
		meanX += luma(reference.data, index * 4)
		meanY += luma(candidate.data, index * 4)
		alphaError += Math.abs(reference.data[index * 4 + 3] - candidate.data[index * 4 + 3])
	}
	meanX /= count
	meanY /= count

	let varianceX = 0
	let varianceY = 0
	let covariance = 0
	let edgeError = 0
	let edgeWeight = 0
	for (let y = 0; y < reference.height; y += 1) {
		for (let x = 0; x < reference.width; x += 1) {
			const index = y * reference.width + x
			if (index >= count) break
			const valueX = luma(reference.data, index * 4)
			const valueY = luma(candidate.data, index * 4)
			varianceX += (valueX - meanX) ** 2
			varianceY += (valueY - meanY) ** 2
			covariance += (valueX - meanX) * (valueY - meanY)
			if (x && y) {
				const referenceEdge = Math.abs(valueX - luma(reference.data, (index - 1) * 4)) + Math.abs(valueX - luma(reference.data, (index - reference.width) * 4))
				const candidateEdge = Math.abs(valueY - luma(candidate.data, (index - 1) * 4)) + Math.abs(valueY - luma(candidate.data, (index - candidate.width) * 4))
				const weight = 1 + Math.min(4, referenceEdge / 24)
				edgeError += Math.abs(referenceEdge - candidateEdge) * weight
				edgeWeight += 510 * weight
			}
		}
	}
	varianceX /= Math.max(1, count - 1)
	varianceY /= Math.max(1, count - 1)
	covariance /= Math.max(1, count - 1)
	const c1 = (0.01 * 255) ** 2
	const c2 = (0.03 * 255) ** 2
	const ssim = ((2 * meanX * meanY + c1) * (2 * covariance + c2)) / ((meanX ** 2 + meanY ** 2 + c1) * (varianceX + varianceY + c2))
	return { ssim: Math.max(0, Math.min(1, ssim)), edgeError: edgeWeight ? edgeError / edgeWeight : 0, alphaMae: alphaError / count / 255 }
}

export function passesQualityGate(metrics: ImageQualityMetrics, classification: ImageClass, preset: ImageCompressionPreset) {
	const ssimFloor = preset === 'smaller' ? 0.975 : preset === 'higher' ? 0.992 : 0.985
	const edgeCeiling = classification === 'ui-text' ? (preset === 'smaller' ? 0.055 : 0.035) : preset === 'smaller' ? 0.075 : 0.055
	const alphaCeiling = preset === 'smaller' ? 0.008 : 1 / 255
	return metrics.ssim >= ssimFloor && metrics.edgeError <= edgeCeiling && metrics.alphaMae <= alphaCeiling
}
