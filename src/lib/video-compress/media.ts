import {
	BlobSource,
	Input,
	MATROSKA,
	MP4,
	QTFF,
	Quality,
	WEBM,
	canEncodeAudio,
	canEncodeVideo,
	type ConversionAudioOptions,
	type ConversionVideoOptions
} from 'mediabunny'
import type { VideoCompressionConfig } from './types'

export const VIDEO_INPUT_FORMATS = [MP4, QTFF, MATROSKA, WEBM]

export function createVideoInput(file: File) {
	return new Input({
		formats: VIDEO_INPUT_FORMATS,
		source: new BlobSource(file, { maxCacheSize: 16 * 1024 * 1024 })
	})
}

export function videoQuality(config: VideoCompressionConfig) {
	return new Quality({ bitrate: config.videoBitrate, bitrateMode: 'variable' })
}

export async function videoConversionOptions(config: VideoCompressionConfig): Promise<ConversionVideoOptions> {
	const quality = videoQuality(config)
	const encoding = { width: config.width, height: config.height, quality }
	const hardwareAcceleration = await canEncodeVideo('avc', { ...encoding, hardwareAcceleration: 'prefer-hardware' })
		? 'prefer-hardware'
		: 'no-preference'
	if (!(await canEncodeVideo('avc', { ...encoding, hardwareAcceleration }))) {
		throw new Error('当前设备没有可用的 H.264 编码器')
	}

	return {
		codec: 'avc',
		width: config.width,
		height: config.height,
		fit: 'contain',
		frameRate: config.frameRate,
		quality,
		keyFrameInterval: 2,
		hardwareAcceleration,
		forceTranscode: true
	}
}

export async function audioConversionOptions(input: Input, bitrate: number): Promise<ConversionAudioOptions | undefined> {
	const track = await input.getPrimaryAudioTrack()
	if (!track) return undefined

	const codec = await track.getCodec()
	const sourceBitrate = await track.getAverageBitrate().then(value => value ?? track.getBitrate()).catch(() => null)
	if (codec === 'aac' && sourceBitrate !== null && sourceBitrate <= bitrate) return { codec: 'aac' }

	const quality = new Quality({ bitrate })
	const encoding = {
		numberOfChannels: await track.getNumberOfChannels(),
		sampleRate: await track.getSampleRate(),
		quality
	}
	if (!(await canEncodeAudio('aac', encoding))) {
		const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
		registerAacEncoder()
	}
	if (!(await canEncodeAudio('aac', encoding))) throw new Error('当前设备无法编码 AAC 音频')
	return { codec: 'aac', quality, forceTranscode: true }
}

export function videoErrorMessage(error: unknown) {
	if (error instanceof DOMException) {
		if (error.name === 'NotAllowedError') return '没有获得本地文件写入权限'
		if (error.name === 'QuotaExceededError') return '磁盘空间不足，无法继续写入视频'
		if (error.name === 'NotReadableError') return '视频文件当前无法读取，请确认文件未被其它程序占用'
	}

	const message = error instanceof Error ? error.message : '视频处理失败'
	if (/no encodable|encoder|encoding configuration/i.test(message)) return '当前设备没有可用的 H.264 编码器'
	if (/decoder|decode|undecodable/i.test(message)) return '当前浏览器无法解码这个视频'
	if (/format|recognize|read input/i.test(message)) return '无法识别这个视频格式'
	return message
}
