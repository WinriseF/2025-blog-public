import { DEFAULT_STICKER } from './stickers'
import type { MaskItem } from './types'

function getPixelSize(mask: MaskItem, minimum: number, cells: number) {
	return Math.max(minimum, Math.min(mask.width, mask.height) / cells)
}

function drawMosaic(ctx: CanvasRenderingContext2D, source: CanvasImageSource, mask: MaskItem) {
	const pixelSize = getPixelSize(mask, 12, 10)
	const tmp = document.createElement('canvas')
	const tmpCtx = tmp.getContext('2d')
	if (!tmpCtx) return

	tmp.width = Math.max(1, Math.floor(mask.width / pixelSize))
	tmp.height = Math.max(1, Math.floor(mask.height / pixelSize))
	tmpCtx.imageSmoothingEnabled = true
	tmpCtx.drawImage(source, mask.x, mask.y, mask.width, mask.height, 0, 0, tmp.width, tmp.height)

	ctx.save()
	ctx.imageSmoothingEnabled = false
	ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, mask.x, mask.y, mask.width, mask.height)
	ctx.restore()
}

function drawBlur(ctx: CanvasRenderingContext2D, source: CanvasImageSource, mask: MaskItem) {
	const pixelSize = getPixelSize(mask, 18, 12)
	const tmp = document.createElement('canvas')
	const tmpCtx = tmp.getContext('2d')
	if (!tmpCtx) return

	tmp.width = Math.max(1, Math.floor(mask.width / pixelSize))
	tmp.height = Math.max(1, Math.floor(mask.height / pixelSize))
	tmpCtx.imageSmoothingEnabled = true
	tmpCtx.drawImage(source, mask.x, mask.y, mask.width, mask.height, 0, 0, tmp.width, tmp.height)

	ctx.save()
	ctx.beginPath()
	ctx.rect(mask.x, mask.y, mask.width, mask.height)
	ctx.clip()
	ctx.imageSmoothingEnabled = true
	ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, mask.x, mask.y, mask.width, mask.height)
	ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
	ctx.fillRect(mask.x, mask.y, mask.width, mask.height)
	ctx.restore()
}

function drawEmoji(ctx: CanvasRenderingContext2D, mask: MaskItem) {
	const emoji = mask.emoji || DEFAULT_STICKER.emoji
	const fontSize = Math.max(18, Math.min(mask.width, mask.height) * 0.72)

	ctx.save()
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
	ctx.fillText(emoji, mask.x + mask.width / 2, mask.y + mask.height / 2 + fontSize * 0.03)
	ctx.restore()
}

export function drawMaskItem(ctx: CanvasRenderingContext2D, source: CanvasImageSource, mask: MaskItem) {
	if (mask.mode === 'mosaic') {
		drawMosaic(ctx, source, mask)
		return
	}
	if (mask.mode === 'blur') {
		drawBlur(ctx, source, mask)
		return
	}
	drawEmoji(ctx, mask)
}

export function drawImageWithMasks(canvas: HTMLCanvasElement, source: CanvasImageSource, masks: MaskItem[]) {
	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('无法初始化画布')

	ctx.clearRect(0, 0, canvas.width, canvas.height)
	ctx.imageSmoothingEnabled = true
	ctx.filter = 'none'
	ctx.drawImage(source, 0, 0, canvas.width, canvas.height)

	for (const mask of masks) {
		drawMaskItem(ctx, source, mask)
	}
}
