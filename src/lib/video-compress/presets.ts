import type { VideoCompressionConfig, VideoInspection, VideoPresetId } from './types'

export type CustomVideoPreset = {
	maxHeight: number
	frameRate: number
	videoBitrateMbps: number
}

export const VIDEO_PRESETS: Array<{ id: VideoPresetId; label: string; description: string }> = [
	{ id: 'clarity', label: '清晰优先', description: '保留原分辨率，目标约原大小 84%' },
	{ id: 'balanced', label: '均衡', description: '最高 1080p，目标约原大小 63%' },
	{ id: 'compact', label: '小体积', description: '最高 720p，目标约原大小 39%' },
	{ id: 'custom', label: '自定义', description: '自行设置分辨率、帧率与码率' }
]

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)

function dimensionsFor(inspection: VideoInspection, maxHeight: number | null) {
	if (!maxHeight || inspection.height <= maxHeight) {
		return { width: even(inspection.width), height: even(inspection.height) }
	}

	const scale = maxHeight / inspection.height
	return {
		width: even(inspection.width * scale),
		height: even(maxHeight)
	}
}

function presetBitrate(preset: Exclude<VideoPresetId, 'custom'>, height: number) {
	if (preset === 'compact') return 2_500_000
	if (preset === 'balanced') return height <= 720 ? 3_000_000 : 5_000_000
	if (height <= 720) return 4_000_000
	if (height <= 1080) return 8_000_000
	if (height <= 1440) return 12_000_000
	return 24_000_000
}

function sourceTotalBitrate(inspection: VideoInspection) {
	if (inspection.duration && inspection.duration > 0) return inspection.size * 8 / inspection.duration
	const trackBitrate = (inspection.videoBitrate ?? 0) + (inspection.audioBitrate ?? 0)
	return trackBitrate > 0 ? trackBitrate : null
}

function estimatedAudioBitrate(inspection: VideoInspection, configuredBitrate: number) {
	if (!inspection.audioCodec) return 0
	const sourceBitrate = inspection.audioBitrate
	return inspection.audioCodec === 'aac' && sourceBitrate && sourceBitrate <= configuredBitrate
		? sourceBitrate
		: configuredBitrate
}

export function resolveVideoCompressionConfig(inspection: VideoInspection, preset: VideoPresetId, custom: CustomVideoPreset): VideoCompressionConfig {
	const maxHeight = preset === 'clarity' ? null : preset === 'balanced' ? 1080 : preset === 'compact' ? 720 : custom.maxHeight
	const dimensions = dimensionsFor(inspection, maxHeight)
	const frameRateLimit = preset === 'clarity' ? 60 : preset === 'custom' ? custom.frameRate : 30
	const sourceFrameRate = inspection.frameRate && Number.isFinite(inspection.frameRate) ? inspection.frameRate : 30
	const audioBitrate = preset === 'compact' ? 128_000 : 160_000
	const requestedBitrate = preset === 'custom' ? Math.round(custom.videoBitrateMbps * 1_000_000) : presetBitrate(preset, dimensions.height)
	const totalBitrate = sourceTotalBitrate(inspection)
	const targetRatio = preset === 'clarity' ? 0.82 : preset === 'balanced' ? 0.62 : 0.38
	const sourceLimitedBitrate = preset !== 'custom' && totalBitrate
		? Math.max(250_000, Math.floor(totalBitrate * targetRatio - estimatedAudioBitrate(inspection, audioBitrate)))
		: requestedBitrate

	return {
		preset,
		...dimensions,
		frameRate: Math.max(1, Math.min(sourceFrameRate, frameRateLimit)),
		videoBitrate: Math.max(250_000, Math.min(requestedBitrate, sourceLimitedBitrate)),
		audioBitrate
	}
}

export function estimateVideoOutputBytes(inspection: VideoInspection, config: VideoCompressionConfig) {
	if (!inspection.duration || !Number.isFinite(inspection.duration)) return null
	const audioBitrate = estimatedAudioBitrate(inspection, config.audioBitrate)
	return Math.ceil((inspection.duration * (config.videoBitrate + audioBitrate)) / 8 * 1.02)
}
