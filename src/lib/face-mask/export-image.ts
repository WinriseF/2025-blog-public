import { drawImageWithMasks } from './draw-mask'
import type { LoadedImage, MaskItem } from './types'

type ExportFormat = {
	mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
	extension: 'jpg' | 'png' | 'webp'
	quality?: number
}

const EXPORT_QUALITY = 0.9
const SIZE_GROWTH_LIMIT = 1.15
const PNG_FORMAT: ExportFormat = { mimeType: 'image/png', extension: 'png' }
const WEBP_FORMAT: ExportFormat = { mimeType: 'image/webp', extension: 'webp', quality: EXPORT_QUALITY }

function normalizeImageType(type: string): ExportFormat {
	if (type === 'image/jpeg' || type === 'image/jpg') {
		return { mimeType: 'image/jpeg', extension: 'jpg', quality: EXPORT_QUALITY }
	}
	if (type === 'image/webp') return WEBP_FORMAT
	if (type === 'image/png') return PNG_FORMAT
	return WEBP_FORMAT
}

function shouldTryWebpFallback(blob: Blob, image: LoadedImage, format: ExportFormat) {
	return format.mimeType !== 'image/webp' && image.file.size > 0 && blob.size > image.file.size * SIZE_GROWTH_LIMIT
}

function toBlob(canvas: HTMLCanvasElement, format: ExportFormat) {
	return new Promise<Blob>((resolve, reject) => {
		try {
			canvas.toBlob(
				blob => {
					if (!blob) {
						reject(new Error('无法生成图片文件'))
						return
					}
					if (blob.type && blob.type !== format.mimeType) {
						reject(new Error('浏览器不支持该导出格式'))
						return
					}
					resolve(blob)
				},
				format.mimeType,
				format.quality
			)
		} catch (error) {
			reject(error)
		}
	})
}

function getPrivacyFileName(name: string, extension: string) {
	const baseName = name.replace(/\.[^.]+$/, '') || 'image'
	return `${baseName}-privacy.${extension}`
}

async function renderMaskedBlob(image: LoadedImage, masks: MaskItem[]) {
	const canvas = document.createElement('canvas')
	canvas.width = image.width
	canvas.height = image.height
	drawImageWithMasks(canvas, image.bitmap, masks)

	const primaryFormat = normalizeImageType(image.type)
	let outputFormat = primaryFormat
	let primaryBlob: Blob
	try {
		primaryBlob = await toBlob(canvas, primaryFormat)
	} catch (error) {
		if (primaryFormat.mimeType === PNG_FORMAT.mimeType) throw error
		outputFormat = PNG_FORMAT
		primaryBlob = await toBlob(canvas, PNG_FORMAT)
	}

	if (!shouldTryWebpFallback(primaryBlob, image, outputFormat)) {
		return { blob: primaryBlob, format: outputFormat }
	}

	try {
		const webpBlob = await toBlob(canvas, WEBP_FORMAT)
		if (webpBlob.size < primaryBlob.size) return { blob: webpBlob, format: WEBP_FORMAT }
	} catch {
		// Keep the primary export when the browser cannot encode WebP.
	}

	return { blob: primaryBlob, format: outputFormat }
}

export async function downloadMaskedImage(image: LoadedImage, masks: MaskItem[]) {
	const { blob, format } = await renderMaskedBlob(image, masks)
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = getPrivacyFileName(image.name, format.extension)
	document.body.appendChild(link)
	link.click()
	link.remove()
	URL.revokeObjectURL(url)
}
