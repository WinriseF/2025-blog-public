import { compressImage } from '../image-compress/pipeline'
import { DEFAULT_IMAGE_COMPRESSION_OPTIONS } from '../image-compress/presets'
import type { ImageCompressionPreset } from '../image-compress/types'

export async function optimizeOfficeImage(file: File, preset: ImageCompressionPreset): Promise<ArrayBuffer | null> {
	try {
		const result = await compressImage({
			file,
			options: { ...DEFAULT_IMAGE_COMPRESSION_OPTIONS, preset },
			limits: { lowMemory: true },
			onProgress: () => {}
		})
		return result.usedOriginal ? null : result.bytes
	} catch {
		return null
	}
}
