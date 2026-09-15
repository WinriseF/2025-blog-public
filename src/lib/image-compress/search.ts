import { jpegliDistances } from './presets'
import type { CandidatePlan, ImageClass, ImageCompressionPreset, ImageQualityMetrics } from './types'

// Leave room below every quality limit before spending another encode on size.
export function hasQualityHeadroom(metrics: ImageQualityMetrics, classification: ImageClass, preset: ImageCompressionPreset) {
	return metrics.ssim >= (preset === 'higher' ? 0.997 : 0.993)
		&& metrics.edgeError <= (classification === 'ui-text' ? 0.0175 : 0.0275)
		&& metrics.alphaMae <= 0.5 / 255
}

export function nextCandidate(plan: CandidatePlan, result: { passed: boolean; metrics: ImageQualityMetrics }, classification: ImageClass, preset: ImageCompressionPreset, substantialGain: boolean): CandidatePlan | null {
	if (preset === 'smaller') return null
	const headroom = result.passed && hasQualityHeadroom(result.metrics, classification, preset)
	if (plan.format === 'jpeg') {
		const distances = jpegliDistances(preset, classification)
		if (plan.jpegDistance !== distances[1]) return null
		if (!result.passed) return { ...plan, jpegDistance: distances[0] }
		if (headroom && substantialGain) return { ...plan, jpegDistance: distances[2] }
	}
	if (preset === 'smart' && plan.quantization?.maxColors === 256 && headroom && substantialGain) {
		return { ...plan, quantization: { ...plan.quantization, maxColors: 128 } }
	}
	return null
}
