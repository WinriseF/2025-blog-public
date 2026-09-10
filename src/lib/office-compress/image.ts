import { compressImage } from '../image-compress/pipeline'
import { DEFAULT_IMAGE_COMPRESSION_OPTIONS } from '../image-compress/presets'
import type { ImageCompressionPreset, ImageCompressionResult } from '../image-compress/types'

function logDiagnostics(file: File, result: ImageCompressionResult) {
	if (process.env.NODE_ENV === 'production') return
	console.debug('[office-image-compress]', {
		file: file.name,
		originalBytes: result.originalBytes,
		finalBytes: result.outputBytes,
		classification: result.classification,
		diagnostics: result.diagnostics.map(({ metrics, ...diagnostic }) => ({
			...diagnostic,
			ssim: metrics?.ssim,
			edgeError: metrics?.edgeError,
			alphaMae: metrics?.alphaMae
		}))
	})
}

export async function optimizeOfficeImage(file: File, preset: ImageCompressionPreset): Promise<ArrayBuffer | null> {
	try {
		const result = await compressImage({
			file,
			options: { ...DEFAULT_IMAGE_COMPRESSION_OPTIONS, preset },
			limits: { lowMemory: true },
			onProgress: () => {}
		})
		logDiagnostics(file, result)
		return result.usedOriginal ? null : result.bytes
	} catch (error) {
		if (process.env.NODE_ENV !== 'production') console.debug('[office-image-compress]', { file: file.name, error: error instanceof Error ? error.message : String(error) })
		return null
	}
}
