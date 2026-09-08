import { loadPica } from './cdn'
import { computeTargetSize } from './presets'
import { IMAGE_FORMAT_META } from './sniff'
import type { ImageCompressionOptions, ImageDeviceLimits, ImageFormat } from './types'

export class NativeWorkerDecodeUnavailable extends Error {}

function canvasImageData(canvas: OffscreenCanvas) {
	const context = canvas.getContext('2d', { willReadFrequently: true })
	if (!context) throw new Error('无法创建图片画布')
	return context.getImageData(0, 0, canvas.width, canvas.height)
}

export async function decodeImageInWorker(
	file: File,
	containerWidth: number,
	containerHeight: number,
	options: ImageCompressionOptions,
	limits: ImageDeviceLimits
) {
	if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
		throw new NativeWorkerDecodeUnavailable('当前浏览器需要使用兼容解码路径')
	}

	const warnings: string[] = []
	const sourcePixels = containerWidth * containerHeight
	const protectiveResize = sourcePixels > limits.maxPixels * 1.35 && containerWidth > 0 && containerHeight > 0
	const requested = computeTargetSize(containerWidth || 1, containerHeight || 1, options.maxWidth, limits.maxPixels)
	let bitmap: ImageBitmap
	try {
		if (protectiveResize) {
			bitmap = await createImageBitmap(file, {
				imageOrientation: 'from-image',
				resizeWidth: requested.width,
				resizeHeight: requested.height,
				resizeQuality: 'high'
			})
			warnings.push('为避免大图导致浏览器内存不足，已在解码阶段限制像素数量')
		} else {
			bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'default' })
		}
	} catch (error) {
		throw new NativeWorkerDecodeUnavailable(error instanceof Error ? `后台图片解码失败：${error.message}` : '后台图片解码失败')
	}

	try {
		const target = computeTargetSize(bitmap.width, bitmap.height, options.maxWidth, limits.maxPixels)
		if (target.limitedByMemory && !protectiveResize) warnings.push('图片像素较大，已按当前设备内存预算等比缩小')
		const source = new OffscreenCanvas(bitmap.width, bitmap.height)
		const sourceContext = source.getContext('2d', { willReadFrequently: false })
		if (!sourceContext) throw new Error('无法创建图片解码画布')
		sourceContext.drawImage(bitmap, 0, 0)
		if (target.width === bitmap.width && target.height === bitmap.height) return { image: canvasImageData(source), warnings }

		const destination = new OffscreenCanvas(target.width, target.height)
		const pica = await loadPica()
		await pica.resize(source, destination, { filter: 'mks2013' })
		return { image: canvasImageData(destination), warnings }
	} finally {
		bitmap.close()
	}
}

export async function decodeEncodedCandidate(bytes: ArrayBuffer, format: ImageFormat, width: number, height: number) {
	if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null
	const maxSide = 384
	const scale = Math.min(1, maxSide / Math.max(width, height))
	const targetWidth = Math.max(1, Math.round(width * scale))
	const targetHeight = Math.max(1, Math.round(height * scale))
	const bitmap = await createImageBitmap(new Blob([bytes], { type: IMAGE_FORMAT_META[format].mime }), {
		resizeWidth: targetWidth,
		resizeHeight: targetHeight,
		resizeQuality: 'high'
	})
	try {
		const canvas = new OffscreenCanvas(targetWidth, targetHeight)
		const context = canvas.getContext('2d', { willReadFrequently: true })
		if (!context) return null
		context.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
		return context.getImageData(0, 0, targetWidth, targetHeight)
	} finally {
		bitmap.close()
	}
}

export function flattenAlpha(image: ImageData, background: string) {
	const red = Number.parseInt(background.slice(1, 3), 16) || 255
	const green = Number.parseInt(background.slice(3, 5), 16) || 255
	const blue = Number.parseInt(background.slice(5, 7), 16) || 255
	const data = new Uint8ClampedArray(image.data.length)
	for (let index = 0; index < image.data.length; index += 4) {
		const alpha = image.data[index + 3] / 255
		data[index] = Math.round(image.data[index] * alpha + red * (1 - alpha))
		data[index + 1] = Math.round(image.data[index + 1] * alpha + green * (1 - alpha))
		data[index + 2] = Math.round(image.data[index + 2] * alpha + blue * (1 - alpha))
		data[index + 3] = 255
	}
	return new ImageData(data, image.width, image.height)
}
