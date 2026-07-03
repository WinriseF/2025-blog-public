import { drawImageWithMasks } from './draw-mask'
import type { LoadedImage, MaskItem } from './types'

function toBlob(canvas: HTMLCanvasElement, type = 'image/png') {
	return new Promise<Blob>((resolve, reject) => {
		try {
			canvas.toBlob(blob => {
				if (blob) resolve(blob)
				else reject(new Error('无法生成图片文件'))
			}, type)
		} catch (error) {
			reject(error)
		}
	})
}

function getPrivacyFileName(name: string) {
	const baseName = name.replace(/\.[^.]+$/, '') || 'image'
	return `${baseName}-privacy.png`
}

async function renderMaskedBlob(image: LoadedImage, masks: MaskItem[]) {
	const canvas = document.createElement('canvas')
	canvas.width = image.width
	canvas.height = image.height
	drawImageWithMasks(canvas, image.bitmap, masks)
	return toBlob(canvas)
}

export async function downloadMaskedImage(image: LoadedImage, masks: MaskItem[]) {
	const blob = await renderMaskedBlob(image, masks)
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = getPrivacyFileName(image.name)
	document.body.appendChild(link)
	link.click()
	link.remove()
	URL.revokeObjectURL(url)
}
